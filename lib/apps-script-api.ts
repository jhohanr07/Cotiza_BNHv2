// Cliente para el backend de Google Apps Script que actúa como base de datos
// (Google Sheets) de la calculadora de financiamiento.
//
// Requiere la variable de entorno NEXT_PUBLIC_APPS_SCRIPT_URL apuntando a la
// URL de implementación (Web App) del script en apps-script/Code.gs.
// Ver apps-script/README.md para el paso a paso de despliegue.

export type Equipo = {
  /** Identificador único (número de fila de la hoja); la columna ID de la hoja se repite por línea. */
  id: string;
  /** Columna "ID" de la hoja (TeAir, MX, N7, N8, Resona i9...). */
  linea: string;
  /** Columna "Nombre". */
  nombre: string;
  /** Columna "Categoria". */
  categoria: string;
  /** Columna "Credito": precio para el escenario de crédito (base imponible). */
  credito: number;
  /** Columna "Equipo" (también acepta "Contado"): precio para el escenario de contado. */
  contado: number;
  /** Columna "Base ajustada". */
  baseAjustada: number;
  /** Columna "2IVA" (también acepta "IVA ajustado"). */
  ivaAjustado: number;
};

export type TasaPorPlazo = {
  meses: number;
  /** Tasa mensual como fracción (0.0153 = 1,53% mensual). */
  tasa: number;
};

/**
 * Condiciones de una categoría, leídas de la hoja "CATEGORIA".
 * Los porcentajes llegan como fracción (0.2 = 20%). Los campos null
 * significan que la hoja no trae esa columna / está vacía.
 *
 * - `tasas` solo incluye los plazos disponibles: los que dicen "Sin calculo"
 *   o están vacíos en la hoja no aparecen.
 * - `maxInstallments` es el plazo más largo disponible en `tasas` (o el valor
 *   de la columna opcional "Cuotas maximas" si existe).
 */
export type CategoriaConfig = {
  nombre: string;
  minInitialRate: number | null;
  suggestedInitialRate: number | null;
  maxInstallments: number | null;
  canPayVATSeparately: boolean | null;
  commissionRate: number | null;
  tasaAnual: number | null;
  tasas: TasaPorPlazo[];
};

export type QuotePayload = {
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  vendedorName: string;
  equipo: string;
  categoria: string;
  basePrice: number;
  initialAmount: number;
  installments: number;
  monthlyPayment: number;
  totalToPay: number;
  ivaFinancing: "si" | "no";
  ivaToPay: number;
  // Escenario "De contado" (opcional; si no llega, el PDF sale como antes)
  contadoPrecio?: number;
  contadoIva?: number;
  contadoTotal?: number;
  /** Porcentaje de ajuste aplicado al IVA de contado (ej. 20 = -20%). */
  contadoAjustePct?: number;
  // Monto ajustado (botón "Ajustado"): base ajustada + 2IVA de la lista
  ajustado?: boolean;
  ajustadoBase?: number;
  ajustadoIva?: number;
  ajustadoTotal?: number;
  logoUrl?: string;
};

type ApiResponse<T> = {
  success: boolean;
  error?: string;
  warning?: string;
} & T;

function getAppsScriptUrl(): string {
  const url = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

  if (!url) {
    throw new Error(
      "Falta configurar NEXT_PUBLIC_APPS_SCRIPT_URL con la URL del Web App de Google Apps Script."
    );
  }

  return url;
}

/**
 * Obtiene el catálogo de equipos desde la hoja "PRECIO EQUIPOS"
 * (ID, Nombre, Categoria, Equipo/contado, Credito, Base ajustada, 2IVA).
 */
export async function fetchEquipos(): Promise<Equipo[]> {
  const baseUrl = getAppsScriptUrl();

  const response = await fetch(`${baseUrl}?action=getEquipos`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("No se pudo consultar la base de datos de equipos.");
  }

  const data = (await response.json()) as ApiResponse<{ equipos: Equipo[] }>;

  if (!data.success) {
    throw new Error(data.error || "Error desconocido al consultar los equipos.");
  }

  return data.equipos ?? [];
}

/**
 * Obtiene la lista de vendedores (solo nombres) desde la hoja "VENDEDORES".
 * Los correos nunca se exponen al navegador: el backend los busca por nombre.
 */
export async function fetchVendedores(): Promise<string[]> {
  const baseUrl = getAppsScriptUrl();

  const response = await fetch(`${baseUrl}?action=getVendedores`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("No se pudo consultar la lista de vendedores.");
  }

  const data = (await response.json()) as ApiResponse<{ vendedores: string[] }>;

  if (!data.success) {
    throw new Error(data.error || "Error desconocido al consultar los vendedores.");
  }

  return data.vendedores ?? [];
}

/**
 * Obtiene las condiciones de cada categoría (inicial mínima y sugerida,
 * cuotas máximas, interés mensual por plazo) desde la hoja "CATEGORIA".
 * La columna A de esa hoja alimenta el desplegable de categoría.
 */
export async function fetchCategorias(): Promise<CategoriaConfig[]> {
  const baseUrl = getAppsScriptUrl();

  const response = await fetch(`${baseUrl}?action=getCategorias`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("No se pudo consultar la hoja de categorías.");
  }

  const data = (await response.json()) as ApiResponse<{
    categorias: CategoriaConfig[];
  }>;

  if (!data.success) {
    throw new Error(data.error || "Error desconocido al consultar las categorías.");
  }

  return data.categorias ?? [];
}

/**
 * Guarda la cotización en la hoja "FUNEL DE VENTA" y dispara el envío del
 * correo con la propuesta al lead/doctor (y, si se ubica en la hoja
 * "VENDEDORES", en copia al vendedor).
 */
export async function saveQuoteAndSendEmail(
  payload: QuotePayload
): Promise<{ warning?: string; numero?: string }> {
  const baseUrl = getAppsScriptUrl();

  const response = await fetch(baseUrl, {
    method: "POST",
    // text/plain evita el preflight OPTIONS, que los Web Apps de Apps
    // Script no manejan de forma nativa.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "saveQuote", ...payload }),
  });

  if (!response.ok) {
    throw new Error("No se pudo enviar la cotización.");
  }

  const data = (await response.json()) as ApiResponse<{ numero?: string }>;

  if (!data.success) {
    throw new Error(data.error || "Error desconocido al guardar/enviar la cotización.");
  }

  return { warning: data.warning, numero: data.numero };
}
