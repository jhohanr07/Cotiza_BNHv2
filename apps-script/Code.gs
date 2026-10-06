/**
 * BNH Medical — Calculadora de Financiamiento
 * ------------------------------------------------------------------
 * Backend en Google Apps Script, vinculado al Google Sheet que actúa
 * como base de datos de la calculadora.
 *
 * Hojas que lee / escribe:
 *   - "PRECIO EQUIPOS"  -> ID | Nombre | Categoria | Equipo (contado) | Credito | Base ajustada | 2IVA
 *   - "CATEGORIA"       -> Categoria | Inicial minima | Inicial sugerida | 12 | 15 | 18 (plazos en meses)
 *   - "VENDEDORES"      -> Nombre | email
 *   - "FUNEL DE VENTA"  -> registro de cotizaciones
 *
 * Las columnas se localizan por el NOMBRE del encabezado (no por posición),
 * sin distinguir mayúsculas, acentos ni espacios sobrantes.
 */

var SHEET_PRECIOS = "PRECIO EQUIPOS";
var SHEET_CATEGORIAS = "CATEGORIA";
var SHEET_FUNEL = "FUNEL DE VENTA";
var SHEET_VENDEDORES = "VENDEDORES";

// Color de marca reutilizado en el correo y en el PDF (mismo tono que
// el botón "Enviar cotización" del frontend).
var BRAND_COLOR = "#0d6f91";
var DARK_COLOR = "#123047";

// Datos fijos del emisor, tal como aparecen en la plantilla de cotización.
var EMISOR = {
  nombre: "BNH Equipos y Suministros Médicos, S.A.",
  rif: "J-50348768-2",
  direccionLineas: [
    "Calle B, Edif. Conjunto Ciudad Center, Torre F, Piso 1, Ofic. 12-F",
    "Urb. Industrial Boleíta Norte, Caracas, Miranda. Zona Postal 1071",
  ],
  web: "bnhmedical.com",
  instagram: "@bnhmedical",
};

var FUNEL_HEADERS = [
  "N° Cotización",
  "Fecha",
  "Vendedor",
  "Lead",
  "Telefono",
  "Email",
  "Equipo",
  "Categoria",
  "Base Imponible",
  "Monto Inicial",
  "Cuotas",
  "Cuota Mensual",
  "Total a Pagar",
  "IVA Financiado",
  "IVA a Pagar",
  "Ajustado",
  "Base Ajustada",
  "IVA Ajustado",
  "Total Ajustado",
];

function doGet(e) {
  try {
    var action = e.parameter.action;

    if (action === "getEquipos") {
      return jsonResponse_({ success: true, equipos: getEquipos_() });
    }

    if (action === "getVendedores") {
      return jsonResponse_({ success: true, vendedores: getVendedores_() });
    }

    if (action === "getCategorias") {
      return jsonResponse_({ success: true, categorias: getCategorias_() });
    }

    return jsonResponse_({ success: false, error: "Acción no reconocida." });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === "saveQuote") {
      return jsonResponse_(saveQuoteAndNotify_(body));
    }

    return jsonResponse_({ success: false, error: "Acción no reconocida." });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err) });
  }
}

/* ------------------------------------------------------------------ */
/* Equipos ("PRECIO EQUIPOS")                                          */
/* ------------------------------------------------------------------ */

/**
 * Lee toda la hoja de precios en una sola lectura por lotes.
 *
 * Columnas (por nombre de encabezado):
 *   ID            -> linea         (se repite por línea de equipos: MX, N7, N8...)
 *   Nombre        -> nombre
 *   Categoria     -> categoria
 *   Equipo        -> contado       (precio de contado; también acepta el encabezado "Contado")
 *   Credito       -> credito       (precio base del escenario de crédito)
 *   Base ajustada -> baseAjustada
 *   2IVA          -> ivaAjustado   (también acepta "IVA ajustado")
 *
 * Si la hoja tiene un encabezado repetido (p. ej. "Credito" dos veces), se usa la primera columna.
 */
function getEquipos_() {
  var sheet = getSheet_(SHEET_PRECIOS);
  var values = sheet.getDataRange().getValues();

  if (values.length < 2) return [];

  var headers = values[0].map(normalizeName_);

  var idxLinea = findCol_(headers, ["id", "linea"]);
  var idxNombre = findCol_(headers, ["nombre"]);
  var idxCategoria = findCol_(headers, ["categoria"]);
  var idxContado = findCol_(headers, ["contado", "equipo"]);
  var idxCredito = findCol_(headers, ["credito", "precio"]);
  var idxBaseAj = findCol_(headers, ["base ajustada"]);
  var idxIvaAj = findCol_(headers, ["2iva", "iva ajustado"]);

  if (idxNombre === -1 || idxCredito === -1) {
    throw new Error(
      'La hoja "' + SHEET_PRECIOS + '" debe tener columnas "Nombre" y "Credito".'
    );
  }

  var equipos = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var nombre = String(row[idxNombre] || "").trim();
    if (!nombre) continue;

    equipos.push({
      id: String(i + 1), // número de fila en la hoja (único, a diferencia de la columna ID)
      linea: idxLinea !== -1 ? String(row[idxLinea] || "").trim() : "",
      nombre: nombre,
      categoria: idxCategoria !== -1 ? String(row[idxCategoria] || "").trim() : "",
      credito: toNumber_(row[idxCredito]),
      contado: idxContado !== -1 ? toNumber_(row[idxContado]) : 0,
      baseAjustada: idxBaseAj !== -1 ? toNumber_(row[idxBaseAj]) : 0,
      ivaAjustado: idxIvaAj !== -1 ? toNumber_(row[idxIvaAj]) : 0,
    });
  }

  return equipos;
}

/* ------------------------------------------------------------------ */
/* Categorías ("CATEGORIA")                                            */
/* ------------------------------------------------------------------ */

/**
 * Lee las condiciones de cada categoría.
 *
 * Estructura de la hoja:
 *   Categoria | Inicial minima | Inicial sugerida | 12 | 15 | 18
 *
 * - "Inicial minima" / "Inicial sugerida": texto tipo "REDONDEAR.MAS( Precio* 0.25; -2)";
 *   se extrae el porcentaje (0.25) y se devuelve como fracción.
 * - Columnas con encabezado numérico (12, 15, 18...) = plazo en meses. Cada celda trae
 *   la fórmula de la tasa, p. ej. "=(1.20 ^ (1 / 12)) - 1"; la tasa mensual se calcula
 *   como base^(1/meses) - 1 (fracción: 0.0153 = 1,53%). Celdas vacías o "Sin calculo"
 *   significan que ese plazo no está disponible para la categoría.
 * - Una categoría puede aparecer en varias filas (una por equipo); se consolidan en una sola.
 * - Columnas opcionales, si algún día se agregan (si no existen devuelven null):
 *   "Cuotas maximas", "Tasa anual", "Comision", "IVA por separado".
 */
function getCategorias_() {
  var sheet = getSheet_(SHEET_CATEGORIAS);
  var values = sheet.getDataRange().getValues();

  if (values.length < 2) return [];

  var rawHeaders = values[0];
  var headers = rawHeaders.map(normalizeName_);

  var idxNombre = findCol_(headers, ["categoria"]);
  if (idxNombre === -1) {
    throw new Error('La hoja "' + SHEET_CATEGORIAS + '" debe tener la columna "Categoria".');
  }

  var idxMin = findCol_(headers, ["inicial minima"]);
  var idxSug = findCol_(headers, ["inicial sugerida"]);
  var idxMaxCuotas = findCol_(headers, ["cuotas maximas", "max cuotas", "maximo de cuotas"]);
  var idxTasaAnual = findCol_(headers, ["tasa anual"]);
  var idxComision = findCol_(headers, ["comision"]);
  var idxIva = findCol_(headers, ["iva por separado", "iva separado", "puede pagar iva por separado"]);

  // Columnas de plazo: encabezado numérico (12, 15, 18...)
  var plazoCols = [];
  for (var c = 0; c < rawHeaders.length; c++) {
    var h = String(rawHeaders[c]).trim();
    if (/^\d+$/.test(h)) plazoCols.push({ idx: c, meses: Number(h) });
  }

  var porNombre = {};
  var orden = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var nombre = String(row[idxNombre] || "").trim();
    if (!nombre) continue;

    var cat = porNombre[nombre];
    if (!cat) {
      cat = {
        nombre: nombre,
        minInitialRate: null,
        suggestedInitialRate: null,
        maxInstallments: null,
        canPayVATSeparately: null,
        commissionRate: null,
        tasaAnual: null,
        tasas: [],
      };
      porNombre[nombre] = cat;
      orden.push(nombre);
    }

    // Los campos solo se rellenan si siguen vacíos: la primera fila con dato manda.
    if (cat.minInitialRate === null && idxMin !== -1) {
      cat.minInitialRate = parseInitialRate_(row[idxMin]);
    }
    if (cat.suggestedInitialRate === null && idxSug !== -1) {
      cat.suggestedInitialRate = parseInitialRate_(row[idxSug]);
    }
    if (cat.maxInstallments === null && idxMaxCuotas !== -1) {
      var mc = toNumber_(row[idxMaxCuotas]);
      cat.maxInstallments = mc > 0 ? mc : null;
    }
    if (cat.tasaAnual === null && idxTasaAnual !== -1) {
      cat.tasaAnual = parseRateValue_(row[idxTasaAnual]);
    }
    if (cat.commissionRate === null && idxComision !== -1) {
      cat.commissionRate = parseRateValue_(row[idxComision]);
    }
    if (cat.canPayVATSeparately === null && idxIva !== -1) {
      cat.canPayVATSeparately = parseBool_(row[idxIva]);
    }

    for (var p = 0; p < plazoCols.length; p++) {
      var meses = plazoCols[p].meses;
      if (hasMeses_(cat.tasas, meses)) continue;
      var tasa = parseMonthlyRate_(row[plazoCols[p].idx]);
      if (tasa !== null) cat.tasas.push({ meses: meses, tasa: tasa });
    }
  }

  return orden.map(function (nombre) {
    var cat = porNombre[nombre];
    cat.tasas.sort(function (a, b) {
      return a.meses - b.meses;
    });
    if (cat.maxInstallments === null && cat.tasas.length) {
      cat.maxInstallments = cat.tasas[cat.tasas.length - 1].meses;
    }
    return cat;
  });
}

function hasMeses_(tasas, meses) {
  for (var i = 0; i < tasas.length; i++) {
    if (tasas[i].meses === meses) return true;
  }
  return false;
}

/** "REDONDEAR.MAS( Precio* 0.25; -2)" -> 0.25. Acepta también 0.25 o 25 (%) como número. */
function parseInitialRate_(cell) {
  if (cell === "" || cell === null || cell === undefined) return null;
  if (typeof cell === "number") return cell > 1 ? cell / 100 : cell;

  var m = String(cell).match(/precio\s*\*\s*(\d+(?:[.,]\d+)?)/i);
  if (m) {
    var v = Number(m[1].replace(",", "."));
    return v > 1 ? v / 100 : v;
  }
  return parseRateValue_(cell);
}

/**
 * Tasa mensual de un plazo:
 *   "A 12 meses: =(1.20 ^ (1 / 12)) - 1 -> 1,53% mensual"  => 1.20^(1/12) - 1 = 0.0153
 *   "18 meses: =(1.30 ^ (1 / 18)) -> 1,0147"               => 1.30^(1/18) - 1 = 0.0147
 *   número (0.0153 o 1.53)                                  => ese valor como fracción
 *   vacío / "Sin calculo"                                   => null (plazo no disponible)
 */
function parseMonthlyRate_(cell) {
  if (cell === "" || cell === null || cell === undefined) return null;
  if (typeof cell === "number") return cell > 1 ? cell / 100 : cell;

  var text = String(cell);
  var m = text.match(/\(\s*(\d+(?:[.,]\d+)?)\s*\^\s*\(\s*1\s*\/\s*(\d+)\s*\)\s*\)/);
  if (!m) return null; // "Sin calculo" u otro texto sin fórmula

  var base = Number(m[1].replace(",", "."));
  var n = Number(m[2]);
  if (!(base > 0) || !(n > 0)) return null;

  return Math.round((Math.pow(base, 1 / n) - 1) * 1e8) / 1e8;
}

/** Porcentaje genérico -> fracción. "20%" -> 0.2, 0.2 -> 0.2, 20 -> 0.2. Vacío -> null. */
function parseRateValue_(cell) {
  if (cell === "" || cell === null || cell === undefined) return null;
  if (typeof cell === "number") return cell > 1 ? cell / 100 : cell;

  var s = String(cell).trim();
  var hasPct = s.indexOf("%") !== -1;
  var n = Number(s.replace("%", "").replace(",", ".").trim());
  if (isNaN(n)) return null;
  return hasPct || n > 1 ? n / 100 : n;
}

function parseBool_(cell) {
  if (cell === "" || cell === null || cell === undefined) return null;
  if (typeof cell === "boolean") return cell;
  var s = normalizeName_(cell);
  if (["si", "sí", "true", "verdadero", "1", "yes"].indexOf(s) !== -1) return true;
  if (["no", "false", "falso", "0"].indexOf(s) !== -1) return false;
  return null;
}

/* ------------------------------------------------------------------ */
/* Vendedores                                                          */
/* ------------------------------------------------------------------ */

/** Devuelve solo los nombres de la hoja "VENDEDORES" (los correos no se exponen). */
function getVendedores_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VENDEDORES);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(normalizeName_);
  var idxNombre = headers.indexOf("nombre");
  if (idxNombre === -1) return [];

  var nombres = [];
  for (var i = 1; i < values.length; i++) {
    var nombre = String(values[i][idxNombre] || "").trim();
    if (nombre) nombres.push(nombre);
  }
  return nombres;
}

/* ------------------------------------------------------------------ */
/* Guardar cotización                                                  */
/* ------------------------------------------------------------------ */

/** Guarda la cotización en "FUNEL DE VENTA", genera el PDF y envía el correo. */
function saveQuoteAndNotify_(data) {
  var required = ["leadName", "leadEmail", "vendedorName"];
  for (var i = 0; i < required.length; i++) {
    if (!data[required[i]]) {
      return { success: false, error: "Falta el campo obligatorio: " + required[i] };
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.leadEmail).trim())) {
    return { success: false, error: "El email del lead no es válido." };
  }

  var fields = ["leadName", "leadPhone", "leadEmail", "vendedorName", "equipo", "categoria"];
  for (var j = 0; j < fields.length; j++) {
    if (String(data[fields[j]] || "").length > 200) {
      return { success: false, error: "El campo " + fields[j] + " es demasiado largo." };
    }
  }

  var sheet = getSheet_(SHEET_FUNEL);
  var numero;

  // Evita filas mezcladas y números de cotización repetidos si dos
  // vendedores guardan al mismo tiempo.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensureFunnelHeaders_(sheet);
    numero = generateQuoteNumber_(sheet); // correlativo = fila que ocupará la nueva cotización
    appendQuoteRow_(sheet, data, numero);
  } finally {
    lock.releaseLock();
  }

  var vendedorEmail = findVendedorEmail_(data.vendedorName);

  var pdfBlob = null;
  var pdfWarning = "";
  try {
    pdfBlob = buildQuotePdfBlob_(data, numero);
  } catch (pdfErr) {
    pdfWarning = "No se pudo adjuntar el PDF de la cotización: " + pdfErr;
  }

  sendQuoteEmail_(data, vendedorEmail, pdfBlob);

  var warnings = [];
  if (!vendedorEmail) {
    warnings.push(
      'No se encontró el correo del vendedor "' +
        data.vendedorName +
        '" en la hoja "' +
        SHEET_VENDEDORES +
        '". Se envió el correo solo al lead.'
    );
  }
  if (pdfWarning) warnings.push(pdfWarning);

  return {
    success: true,
    numero: numero,
    warning: warnings.length ? warnings.join(" ") : undefined,
  };
}

function generateQuoteNumber_(sheet) {
  var correlativo = sheet.getLastRow(); // encabezado = fila 1, así que esto ya es 1-based
  var tz = Session.getScriptTimeZone();
  var fecha = Utilities.formatDate(new Date(), tz, "yyyyMMdd");
  return "COT-" + fecha + "-" + ("000" + correlativo).slice(-3);
}

function appendQuoteRow_(sheet, data, numero) {
  var ajustado = isAjustado_(data);

  sheet.appendRow([
    numero,
    new Date(),
    data.vendedorName || "",
    data.leadName || "",
    data.leadPhone || "",
    data.leadEmail || "",
    data.equipo || "",
    data.categoria || "",
    Number(data.basePrice) || 0,
    Number(data.initialAmount) || 0,
    Number(data.installments) || 0,
    Number(data.monthlyPayment) || 0,
    Number(data.totalToPay) || 0,
    data.ivaFinancing === "no" ? "No" : "Sí",
    Number(data.ivaToPay) || 0,
    ajustado ? "Sí" : "No",
    ajustado ? Number(data.ajustadoBase) || 0 : "",
    ajustado ? Number(data.ajustadoIva) || 0 : "",
    ajustado ? Number(data.ajustadoTotal) || 0 : "",
  ]);
}

/**
 * Si la hoja está vacía escribe todos los encabezados. Si ya tiene datos, solo
 * completa los encabezados nuevos (Ajustado, Base Ajustada...) que falten en
 * la fila 1, sin tocar los existentes.
 */
function ensureFunnelHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(FUNEL_HEADERS);
    return;
  }

  var firstRow = sheet.getRange(1, 1, 1, FUNEL_HEADERS.length).getValues()[0];
  for (var c = 0; c < FUNEL_HEADERS.length; c++) {
    if (!String(firstRow[c] || "").trim()) {
      sheet.getRange(1, c + 1).setValue(FUNEL_HEADERS[c]);
    }
  }
}

/** Busca en la hoja "VENDEDORES" el correo asociado a un nombre (sin distinguir mayúsculas/acentos). */
function findVendedorEmail_(nombreVendedor) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_VENDEDORES);
  if (!sheet) return "";

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return "";

  var headers = values[0].map(normalizeName_);
  var idxNombre = headers.indexOf("nombre");
  var idxEmail = headers.indexOf("email");
  if (idxNombre === -1 || idxEmail === -1) return "";

  var target = normalizeName_(nombreVendedor);

  for (var i = 1; i < values.length; i++) {
    var rowName = normalizeName_(values[i][idxNombre]);
    if (rowName === target) {
      return String(values[i][idxEmail] || "").trim();
    }
  }

  return "";
}

/** Minúsculas, sin acentos y sin espacios sobrantes (también colapsa espacios internos). */
function normalizeName_(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Devuelve el índice de la primera columna cuyo encabezado coincide con alguno de los alias; -1 si no hay. */
function findCol_(normalizedHeaders, aliases) {
  for (var a = 0; a < aliases.length; a++) {
    var idx = normalizedHeaders.indexOf(aliases[a]);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Convierte una celda a número (acepta números, "$1,234.50", "1.234,50" y vacíos). */
function toNumber_(cell) {
  if (typeof cell === "number") return isFinite(cell) ? cell : 0;

  var s = String(cell === null || cell === undefined ? "" : cell)
    .replace(/[$\s]/g, "");
  if (!s) return 0;

  if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) {
    // El último separador es el decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.indexOf(",") !== -1) {
    s = s.replace(",", ".");
  }

  var n = Number(s);
  return isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ */
/* Correo                                                              */
/* ------------------------------------------------------------------ */

function sendQuoteEmail_(data, vendedorEmail, pdfBlob) {
  var subject = "Propuesta de financiamiento BNH Medical" + (data.equipo ? " - " + data.equipo : "");
  var html = buildQuoteEmailHtml_(data);

  var options = { htmlBody: html };
  if (vendedorEmail) options.cc = vendedorEmail;
  if (pdfBlob) options.attachments = [pdfBlob];

  MailApp.sendEmail(data.leadEmail, subject, "", options);
}

function buildQuoteEmailHtml_(data) {
  // Solo se acepta un logo por https (evita inyectar URLs arbitrarias en el correo)
  var logo = /^https:\/\/[^\s"'<>]+$/.test(String(data.logoUrl || ""))
    ? '<img src="' + escapeHtml_(data.logoUrl) + '" alt="BNH Medical" style="height:60px; margin-bottom:12px;">'
    : "";

  return (
    '<div style="font-family: Verdana, sans-serif; color:#111;">' +
    logo +
    '<h2 style="color:' + BRAND_COLOR + ';">Propuesta de Financiamiento — BNH Medical</h2>' +
    "<p>Estimado(a) <strong>" + escapeHtml_(data.leadName) + "</strong>,</p>" +
    "<p>Adjuntamos la cotización en PDF con el detalle completo de la propuesta. Aquí un resumen:</p>" +
    '<table style="border-collapse:collapse; width:100%; max-width:480px;">' +
    row_("Equipo", escapeHtml_(data.equipo)) +
    row_("Categoría", escapeHtml_(data.categoria)) +
    contadoEmailRows_(data) +
    row_("Base imponible", formatMoney_(data.basePrice)) +
    row_("Monto inicial", formatMoney_(data.initialAmount)) +
    row_("Cantidad de cuotas", String(Number(data.installments) || 0)) +
    row_("Cuota mensual", "<strong>" + formatMoney_(data.monthlyPayment) + "</strong>", true) +
    row_("Total a pagar", formatMoney_(data.totalToPay)) +
    ajustadoEmailRows_(data) +
    "</table>" +
    '<p style="margin-top:16px;">Vendedor a cargo: <strong>' + escapeHtml_(data.vendedorName) + "</strong></p>" +
    '<p style="color:#888; font-size:12px;">Esta propuesta es una simulación comercial y puede variar según las condiciones finales de la operación.</p>' +
    "</div>"
  );
}

function contadoEmailRows_(data) {
  if (!hasContado_(data)) return "";
  var ajuste = Number(data.contadoAjustePct) || 0;
  var ivaLabel = ajuste > 0 ? "I.V.A. (ajuste -" + ajuste + "%)" : "I.V.A. (16%)";
  return (
    '<tr><td colspan="2" style="padding:8px 0 2px; font-weight:bold; color:' + BRAND_COLOR + ';">De contado</td></tr>' +
    row_("Precio del equipo", formatMoney_(data.contadoPrecio)) +
    row_(ivaLabel, formatMoney_(data.contadoIva)) +
    row_("Total de contado", "<strong>" + formatMoney_(data.contadoTotal) + "</strong>") +
    '<tr><td colspan="2" style="padding:12px 0 2px; font-weight:bold; color:' + BRAND_COLOR + ';">Crédito</td></tr>'
  );
}

/** Bloque "Monto ajustado" (base ajustada + 2IVA de la lista); solo si el vendedor activó "Ajustado". */
function ajustadoEmailRows_(data) {
  if (!isAjustado_(data)) return "";
  return (
    '<tr><td colspan="2" style="padding:12px 0 2px; font-weight:bold; color:' + BRAND_COLOR + ';">Monto ajustado</td></tr>' +
    row_("Base ajustada", formatMoney_(data.ajustadoBase)) +
    row_("I.V.A. ajustado", formatMoney_(data.ajustadoIva)) +
    row_("Total ajustado", "<strong>" + formatMoney_(data.ajustadoTotal) + "</strong>", true)
  );
}

function row_(label, value, highlight) {
  var border = highlight ? "border-top:2px solid " + BRAND_COLOR + ";" : "";
  return (
    '<tr><td style="padding:6px 0; ' + border + '">' + label + "</td>" +
    '<td style="padding:6px 0; text-align:right; ' + border + '">' + value + "</td></tr>"
  );
}

/* ------------------------------------------------------------------ */
/* PDF de la cotización ("Cotización de Servicios")                    */
/* ------------------------------------------------------------------ */

/**
 * Genera el PDF de la cotización con DocumentApp y lo devuelve como Blob.
 * No incluye RIF ni dirección del cliente (a propósito): solo nombre,
 * teléfono y correo.
 */
function buildQuotePdfBlob_(data, numero) {
  var tz = Session.getScriptTimeZone();
  var fecha = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy");

  var doc = DocumentApp.create("Cotizacion " + numero);
  var docId = doc.getId();

  try {
    var body = doc.getBody();
    body.setMarginTop(28).setMarginBottom(28).setMarginLeft(40).setMarginRight(40);

    appendLogo_(body, data.logoUrl);

    var title = body.appendParagraph("Cotización de Servicios");
    title.setFontSize(22).setBold(true).setForegroundColor(DARK_COLOR);
    title.setSpacingBefore(6).setSpacingAfter(2);

    var subtitle = body.appendParagraph(EMISOR.nombre);
    subtitle.setFontSize(10).setForegroundColor("#666666").setSpacingAfter(16);

    appendClientIssuerTable_(body, data);

    var meta = body.appendParagraph("N° de cotización: " + numero + "      Fecha: " + fecha);
    meta.setFontSize(10).setForegroundColor("#333333").setSpacingBefore(12).setSpacingAfter(14);

    appendProductTable_(body, data);
    appendSummary_(body, data);
    appendFinancingDetail_(body, data);
    appendConditions_(body);
    appendFooter_(body);

    doc.saveAndClose();

    var pdfBlob = DriveApp.getFileById(docId).getAs("application/pdf");
    pdfBlob.setName("Cotizacion-" + numero + ".pdf");
    return pdfBlob;
  } finally {
    // El documento temporal solo se usa para exportar el PDF; se descarta.
    try {
      DriveApp.getFileById(docId).setTrashed(true);
    } catch (cleanupErr) {
      // Si falla el borrado no debe interrumpir el envío de la cotización.
    }
  }
}

function appendLogo_(body, logoUrl) {
  if (!/^https:\/\/[^\s"'<>]+$/.test(String(logoUrl || ""))) return;

  try {
    var imgBlob = UrlFetchApp.fetch(logoUrl).getBlob();
    var img = body.appendImage(imgBlob);
    var ratio = img.getHeight() / img.getWidth();
    img.setWidth(130);
    img.setHeight(Math.round(130 * ratio));
  } catch (err) {
    // Si no se puede descargar el logo, el PDF se genera sin imagen.
  }
}

function appendClientIssuerTable_(body, data) {
  var table = body.appendTable([["", ""]]);
  table.setBorderWidth(0);

  var row = table.getRow(0);
  fillInfoCell_(row.getCell(0), "Datos del Cliente", [
    data.leadName || "-",
    "Teléfono: " + (data.leadPhone || "-"),
    "Correo: " + (data.leadEmail || "-"),
  ]);
  fillInfoCell_(
    row.getCell(1),
    "Datos del Emisor",
    [EMISOR.nombre, "RIF: " + EMISOR.rif].concat(EMISOR.direccionLineas)
  );
}

function fillInfoCell_(cell, heading, lines) {
  cell.setWidth(250);

  var headingP = cell.getChild(0).asParagraph();
  headingP.setText(heading);
  headingP.setBold(true).setForegroundColor(BRAND_COLOR).setFontSize(11);

  for (var i = 0; i < lines.length; i++) {
    var p = cell.appendParagraph(lines[i]);
    p.setFontSize(9.5).setForegroundColor("#333333");
  }
}

function appendProductTable_(body, data) {
  var rows = [
    ["Producto", "Cantidad", "Precio", "Subtotal"],
    [
      data.equipo || "Equipo cotizado",
      "1",
      formatMoney_(data.basePrice),
      formatMoney_(data.basePrice),
    ],
  ];

  var table = body.appendTable(rows);
  table.setBorderColor("#cccccc").setBorderWidth(1);

  var headerRow = table.getRow(0);
  for (var c = 0; c < headerRow.getNumCells(); c++) {
    var cell = headerRow.getCell(c);
    cell.setBackgroundColor(BRAND_COLOR);
    var p = cell.getChild(0).asParagraph();
    p.setBold(true).setForegroundColor("#ffffff").setFontSize(10);
  }

  var dataRow = table.getRow(1);
  for (var d = 0; d < dataRow.getNumCells(); d++) {
    dataRow.getCell(d).getChild(0).asParagraph().setFontSize(10);
  }
}

function scenarioTitle_(body, text) {
  var t = body.appendParagraph(text);
  t.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  t.setBold(true).setFontSize(12).setForegroundColor(BRAND_COLOR);
  t.setSpacingBefore(10).setSpacingAfter(2);
}

function hasContado_(data) {
  return (
    data.contadoTotal !== undefined &&
    data.contadoTotal !== null &&
    data.contadoTotal !== ""
  );
}

/** true si el vendedor activó el botón "Ajustado" y llegaron los montos. */
function isAjustado_(data) {
  var flag = data.ajustado === true || String(data.ajustado).toLowerCase() === "true";
  return (
    flag &&
    data.ajustadoTotal !== undefined &&
    data.ajustadoTotal !== null &&
    data.ajustadoTotal !== ""
  );
}

function appendSummary_(body, data) {
  body.appendParagraph("").setSpacingAfter(2);

  // Escenario 1: De contado (solo si el front envió los datos)
  if (hasContado_(data)) {
    var ajuste = Number(data.contadoAjustePct) || 0;
    var ivaContadoLabel = ajuste > 0
      ? "I.V.A. (ajuste -" + ajuste + "%)"
      : "I.V.A. (16%)";

    scenarioTitle_(body, "DE CONTADO");
    summaryLine_(body, "Precio del equipo", formatMoney_(data.contadoPrecio), false);
    summaryLine_(body, ivaContadoLabel, formatMoney_(data.contadoIva), false);
    summaryLine_(body, "TOTAL DE CONTADO", formatMoney_(data.contadoTotal), true);

    // Escenario 2: Crédito
    scenarioTitle_(body, "CRÉDITO");
  }

  summaryLine_(body, "Subtotal", formatMoney_(data.basePrice), false);

  var ivaLabel =
    data.ivaFinancing === "no"
      ? "I.V.A. (16%)"
      : "I.V.A. (16%) — incluido en las cuotas";
  summaryLine_(body, ivaLabel, formatMoney_(data.ivaToPay), false);

  summaryLine_(body, "TOTAL", formatMoney_(data.totalToPay), true);

  // Escenario 3: Monto ajustado (solo si se activó "Ajustado")
  if (isAjustado_(data)) {
    scenarioTitle_(body, "MONTO AJUSTADO");
    summaryLine_(body, "Base ajustada", formatMoney_(data.ajustadoBase), false);
    summaryLine_(body, "I.V.A. ajustado", formatMoney_(data.ajustadoIva), false);
    summaryLine_(body, "TOTAL AJUSTADO", formatMoney_(data.ajustadoTotal), true);
  }
}

function summaryLine_(body, label, value, big) {
  var p = body.appendParagraph(label + "      " + value);
  p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  p.setFontSize(big ? 13 : 10.5);
  if (big) {
    p.setBold(true).setForegroundColor(BRAND_COLOR);
    p.setSpacingBefore(4);
  }
}

function appendFinancingDetail_(body, data) {
  var title = body.appendParagraph("Detalle de Financiamiento");
  title.setBold(true).setFontSize(12).setForegroundColor(BRAND_COLOR);
  title.setSpacingBefore(20).setSpacingAfter(6);

  var rows = [
    ["Categoría", data.categoria || "-"],
    ["Monto inicial", formatMoney_(data.initialAmount)],
    ["Cantidad de cuotas", String(Number(data.installments) || 0)],
    ["Cuota mensual", formatMoney_(data.monthlyPayment)],
  ];

  var table = body.appendTable(rows);
  table.setBorderWidth(0);

  for (var r = 0; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    row.getCell(0).getChild(0).asParagraph().setFontSize(10).setForegroundColor("#333333");
    var valueP = row.getCell(1).getChild(0).asParagraph();
    valueP.setFontSize(10).setBold(true);
  }
}

function appendConditions_(body) {
  var title = body.appendParagraph("CONDICIONES");
  title.setBold(true).setFontSize(11).setForegroundColor(BRAND_COLOR);
  title.setSpacingBefore(20).setSpacingAfter(4);

  var lines = [
    "Vigencia de la cotización: 7 días naturales.",
    "Tiempo estimado de entrega: 5 días hábiles a partir del pago de la inicial.",
    "Incluye: Garantía, instalación y capacitación (según equipo).",
    "El monto de las cuotas puede ajustarse según la tasa BCV vigente al momento del pago.",
  ];

  for (var i = 0; i < lines.length; i++) {
    var p = body.appendParagraph("• " + lines[i]);
    p.setFontSize(9.5).setForegroundColor("#333333").setSpacingAfter(2);
  }
}

function appendFooter_(body) {
  var footer = body.appendParagraph(
    EMISOR.web + "   ·   " + EMISOR.instagram + "   ·   " + EMISOR.direccionLineas.join(", ")
  );
  footer.setFontSize(8.5).setForegroundColor("#888888").setSpacingBefore(22);
}

function formatMoney_(n) {
  var value = Number(n) || 0;
  return "$" + value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function escapeHtml_(str) {
  return String(str || "").replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('No se encontró la hoja "' + name + '".');
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
