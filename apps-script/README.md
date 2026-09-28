# Base de datos (Google Sheet) + Backend (Apps Script)

Esta carpeta contiene el backend que convierte un Google Sheet en la base de
datos de la calculadora: catálogo de precios de equipos y "Funel de Venta"
con las cotizaciones generadas por los vendedores.

## 1. Crear el Google Sheet

Crea un Google Sheet nuevo (o usa uno existente) con estas pestañas:

### Hoja "PRECIO EQUIPOS"
| ID | Nombre | Categoria | Precio |
|----|--------|-----------|--------|
| 1  | Ecógrafo DP-500 | dp | 8500 |
| 2  | Consola Consona N7 | consonaN5N7 | 22000 |

- **Categoria** debe ser exactamente una de estas claves (coinciden con las
  categorías ya existentes en la calculadora):
  `dp`, `mx`, `consonaN5N7`, `consonaN8N9`, `alta`, `congresoMX`, `congresoConsona`.
- **Precio** es la Base Imponible en USD (antes de I.V.A./IGTF), igual que el
  campo "Base imponible" que ya usa la calculadora.

### Hoja "FUNEL DE VENTA"
No hace falta crearla con encabezados: el script los agrega automáticamente
la primera vez que se guarda una cotización (N° Cotización, Fecha, Vendedor,
Lead, Teléfono, Email, Equipo, Categoría, Base Imponible, Monto Inicial,
Cuotas, Cuota Mensual, Total a Pagar, IVA Financiado, IVA a Pagar). No
guarda RIF ni dirección del cliente: el formulario no los pide.

### Hoja "VENDEDORES" (alimenta el desplegable y la copia del correo)
| Nombre | Email |
|--------|-------|
| Juan Pérez | juan.perez@bnhmedical.com |

Si el nombre que el vendedor escribe en el formulario coincide con esta
hoja, se le agrega en copia (CC) el correo con la propuesta. Si no coincide
o la hoja no existe, el correo solo llega al lead/doctor (sin bloquear el
envío).

## 2. Desplegar el script

1. En el Google Sheet: **Extensiones → Apps Script**.
2. Borra el contenido por defecto y pega el archivo `Code.gs` de esta carpeta.
3. **Implementar → Nueva implementación**.
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Yo** (tu cuenta, dueña del Sheet).
   - Quién tiene acceso: **Cualquier usuario**.
4. Autoriza los permisos solicitados: lectura/escritura del Sheet, envío de
   correo con `MailApp` (tu propia cuenta de Gmail/Workspace) y, como ahora
   cada cotización genera un PDF, también **Documentos de Google** y
   **Drive** (el script crea un Doc temporal solo para exportarlo a PDF y
   lo borra de inmediato).
5. Copia la URL que termina en `/exec`.

## 3. Conectar el frontend

En el proyecto Next.js, agrega la variable de entorno:

```
NEXT_PUBLIC_APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXXXXXX/exec
```

- Local: crea/edita `.env.local` con esa línea.
- Vercel: **Project Settings → Environment Variables**, agrega
  `NEXT_PUBLIC_APPS_SCRIPT_URL` con el mismo valor y vuelve a desplegar.

## Notas

- Cada vez que edites `Code.gs` desde el editor de Apps Script debes crear
  una **nueva implementación** (o "Gestionar implementaciones → Editar" y
  subir versión) para que los cambios se reflejen en la URL publicada.
- `MailApp.sendEmail` envía el correo desde la cuenta de Google que hizo el
  despliegue y consume su cuota diaria de envíos (100/día en cuentas
  gratuitas, más en Workspace).
- El PDF adjunto ("Cotización de Servicios") se genera con `DocumentApp` a
  partir de los datos de la operación: no reproduce el degradado azul
  decorativo del diseño original, pero sí su misma estructura (datos del
  cliente sin RIF ni dirección, datos del emisor, tabla de producto,
  subtotal/IVA/total, detalle de financiamiento y condiciones).
- Si `UrlFetchApp` no logra descargar el logo (por ejemplo, si el sitio aún
  no está publicado en Vercel), el PDF se genera igualmente, sin la imagen.
