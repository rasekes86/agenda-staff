# Extensión de Chrome - Calendario Colaborativo

## Descripción

Esta extensión de Chrome proporciona un calendario colaborativo que aparece como una barra lateral en el navegador. Todos los usuarios que tengan la extensión instalada podrán ver y gestionar los mismos eventos en tiempo real.

## Características

- **Barra lateral integrada**: El calendario aparece en el lado derecho del navegador
- **Sincronización en tiempo real**: Todos los usuarios ven los mismos eventos
- **Interfaz sencilla**: Fácil de usar para añadir y eliminar eventos
- **Colores personalizables**: Cada evento puede tener un color diferente
- **Indicador de conexión**: Muestra el estado de sincronización
- **Modo oscuro**: Se adapta automáticamente al tema del sistema

## Instalación

### Paso 1: Descargar la extensión

Descarga la carpeta `chrome-extension` completa desde el proyecto.

### Paso 2: Abrir la página de extensiones

1. Abre Google Chrome
2. En la barra de direcciones, escribe: `chrome://extensions`
3. Presiona Enter

### Paso 3: Activar el modo desarrollador

En la esquina superior derecha de la página, activa el interruptor "Modo desarrollador".

### Paso 4: Cargar la extensión

1. Haz clic en el botón "Cargar descomprimida" (o "Load unpacked")
2. Navega hasta la carpeta `chrome-extension`
3. Selecciona la carpeta y haz clic en "Seleccionar carpeta"

### Paso 5: Verificar la instalación

La extensión debería aparecer en tu lista de extensiones con el nombre "Calendario Colaborativo".

## Uso

### Abrir el calendario

- Haz clic en el icono de la extensión en la barra de herramientas de Chrome
- El calendario se abrirá como una barra lateral en el lado derecho

### Navegar por el calendario

- Usa las flechas `<` y `>` para cambiar de mes
- Haz clic en "Hoy" para volver al mes actual
- Haz clic en cualquier día para ver sus eventos

### Añadir un evento

1. Selecciona el día deseado
2. Haz clic en el botón "Añadir"
3. Completa el formulario:
   - **Título**: Nombre del evento (requerido)
   - **Descripción**: Detalles adicionales (opcional)
   - **Hora**: Hora del evento (opcional)
   - **Color**: Color del evento
4. Haz clic en "Guardar"

### Editar un evento

1. Selecciona el día del evento
2. Haz clic en el icono de editar (lápiz) del evento
3. Modifica los campos deseados
4. Haz clic en "Guardar"

### Eliminar un evento

1. Selecciona el día del evento
2. Haz clic en el icono de eliminar (papelera) del evento
3. El evento se eliminará inmediatamente

## Requisitos del Servidor

La extensión requiere un servidor backend para la sincronización de datos. Por defecto, se conecta a:

```
http://localhost:3000/api/calendar/events
```

### Configurar el servidor

El servidor Next.js incluido en el proyecto proporciona la API necesaria. Para iniciarlo:

```bash
cd /home/z/my-project
bun run dev
```

### Cambiar la URL del servidor

Si necesitas cambiar la URL del servidor, edita el archivo `sidepanel.js` y modifica la constante `API_BASE_URL`:

```javascript
const API_BASE_URL = 'https://tu-servidor.com/api';
```

## Estructura de Archivos

```
chrome-extension/
├── manifest.json       # Configuración de la extensión
├── sidepanel.html      # Interfaz del calendario
├── sidepanel.css       # Estilos del calendario
├── sidepanel.js        # Lógica del calendario
├── background.js       # Service worker
└── icons/
    ├── icon16.png      # Icono 16x16
    ├── icon32.png      # Icono 32x32
    ├── icon48.png      # Icono 48x48
    └── icon128.png     # Icono 128x128
```

## API del Backend

### GET /api/calendar/events

Obtiene todos los eventos del calendario.

**Respuesta:**
```json
[
  {
    "id": "abc123",
    "title": "Reunión de equipo",
    "description": "Discutir el proyecto Q1",
    "date": "2024-02-15",
    "time": "10:00",
    "color": "#3b82f6",
    "createdAt": "2024-02-01T10:00:00Z",
    "updatedAt": "2024-02-01T10:00:00Z"
  }
]
```

### POST /api/calendar/events

Sincroniza todos los eventos.

**Cuerpo:**
```json
{
  "events": [...]
}
```

### DELETE /api/calendar/events?id={id}

Elimina un evento específico.

## Solución de Problemas

### El calendario no sincroniza

1. Verifica que el servidor Next.js esté corriendo
2. Comprueba la consola del navegador para ver errores
3. Verifica que la URL del servidor sea correcta

### La extensión no aparece

1. Verifica que la extensión esté habilitada en `chrome://extensions`
2. Intenta recargar la extensión
3. Verifica que todos los archivos estén presentes

### Los eventos no se guardan

1. Verifica la conexión al servidor
2. Comprueba los permisos en el manifest.json
3. Revisa la consola para mensajes de error

## Permisos

La extensión requiere los siguientes permisos:

- `sidePanel`: Para mostrar la barra lateral
- `storage`: Para almacenamiento local de respaldo
- `alarms`: Para sincronización periódica

## Licencia

Este proyecto es de código abierto.
