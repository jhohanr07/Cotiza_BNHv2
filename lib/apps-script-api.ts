// Cliente para el backend de Google Apps Script que actúa como base de datos
// (Google Sheets) de la calculadora de financiamiento.
//
// Requiere la variable de entorno NEXT_PUBLIC_APPS_SCRIPT_URL apuntando a la
// URL de implementación (Web App) del script en apps-script/Code.gs.
// Ver apps-script/README.md para el paso a paso de despliegue.

export type Equipo = {
  id: string;
  nombre: string;
  categoria: string;
  precio: number;
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
  contadoAjustePct?: number;
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
 * Obtiene el catálogo de equipos (nombre, categoría y precio) desde la hoja
 * "PRECIO EQUIPOS" del Google Sheet configurado como base de datos.
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
