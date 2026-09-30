# Política de Privacidad de AGENDA STAFF

**Última actualización:** 30 de septiembre de 2026

AGENDA STAFF es una extensión de Chrome destinada a facilitar la gestión operativa de personal, la organización de eventos y recordatorios, la gestión de firmas autorizadas y la preparación, cumplimentación y exportación de documentos PDF.

Esta Política de Privacidad explica qué información trata la extensión, con qué finalidad, dónde se almacena y qué opciones tienen sus usuarios.

## 1. Responsable y contacto

El responsable de AGENDA STAFF es el editor de la extensión.

Para consultas sobre privacidad, solicitudes relacionadas con los datos o incidencias de seguridad, puede utilizar el canal público de soporte del proyecto:

<https://github.com/rasekes86/agenda-staff/issues>

No incluya contraseñas, documentos de identidad, firmas ni otros datos personales en una incidencia pública. Si una consulta requiere compartir información sensible, solicite primero un canal privado a través de dicho formulario.

## 2. Información tratada

AGENDA STAFF puede tratar las siguientes categorías de información cuando el usuario utiliza voluntariamente las funciones correspondientes:

### 2.1. Datos de cuenta y autenticación

- Dirección de correo electrónico.
- Nombre asociado a la cuenta.
- Identificador interno del usuario.
- Tokens técnicos de sesión necesarios para mantener la autenticación.

La contraseña se envía directamente al servicio de autenticación para iniciar sesión. AGENDA STAFF no la almacena en texto legible.

### 2.2. Agenda y recordatorios

- Títulos, fechas, horas, descripciones y estado de los eventos creados por el usuario.
- Preferencias de notificación y antelación de los recordatorios.

### 2.3. Firmas y datos de personal

- Nombre asociado a una firma.
- Imagen de la firma cargada, dibujada o recortada por un usuario autorizado.
- Identificadores como DNI o NIE cuando el usuario los introduce en un documento o listado.
- Nombre del usuario que incorpora o administra una firma, cuando resulte necesario para la trazabilidad interna.

### 2.4. Plantillas y documentos

- Plantillas PDF creadas por los usuarios, incluidos la posición, el tipo y la configuración de sus campos.
- Archivos PDF, imágenes y documentos seleccionados para editar, convertir, combinar o exportar.
- Borradores y estado temporal del editor necesarios para recuperar el trabajo.

El contenido de los archivos se procesa principalmente en el dispositivo del usuario. Solo se sincronizan con el servicio remoto aquellos datos para los que la función utilizada requiera expresamente almacenamiento compartido, como las firmas, las plantillas o los eventos.

### 2.5. Contenido visible en Gmail

Cuando el usuario utiliza Gmail, AGENDA STAFF puede analizar localmente el contenido visible del mensaje abierto para identificar posibles nombres de trabajadores y mostrar si existe una firma registrada.

- El análisis se realiza en el navegador.
- No se almacena ni se envía a servidores externos el contenido completo de los correos.
- Únicamente se compara el nombre detectado con la relación de nombres de firmas disponible para los usuarios autorizados.
- La extensión no lee correos que el usuario no haya abierto ni accede a la cuenta mediante la API de Gmail.

### 2.6. Capturas y recortes iniciados por el usuario

La extensión puede acceder a la imagen visible de una pestaña únicamente cuando el usuario inicia expresamente una captura o selecciona una pestaña para recortar una firma. La imagen seleccionada se utiliza para completar la acción solicitada y no para supervisar la navegación.

## 3. Finalidades del tratamiento

La información se utiliza exclusivamente para:

- Autenticar al usuario y mantener activa su sesión.
- Sincronizar la agenda y mostrar los recordatorios configurados.
- Guardar, localizar, insertar y administrar firmas autorizadas.
- Crear, compartir, editar y aplicar plantillas documentales.
- Cumplimentar y generar documentos individuales o colectivos.
- Convertir, combinar, ordenar y editar documentos e imágenes.
- Detectar localmente nombres visibles en Gmail y señalar la disponibilidad de firmas.
- Conservar preferencias, borradores y ajustes necesarios para el funcionamiento de la extensión.
- Prevenir errores, mantener la seguridad y ofrecer soporte técnico.

AGENDA STAFF no utiliza los datos para publicidad, elaboración de perfiles comerciales, seguimiento entre sitios web, evaluación crediticia ni venta de información.

## 4. Base y control del usuario

Los datos se tratan para prestar las funciones solicitadas por el usuario y dentro del entorno profesional autorizado en el que se utiliza AGENDA STAFF.

El usuario decide cuándo:

- Crea un evento o recordatorio.
- Carga, dibuja o recorta una firma.
- Selecciona un PDF, una imagen o un documento.
- Inicia una captura o elige otra pestaña como origen.
- Crea, modifica o elimina una plantilla.
- Genera y descarga documentos.

## 5. Almacenamiento y servicios externos

### 5.1. Almacenamiento local de Chrome

La extensión utiliza el almacenamiento local de Chrome para conservar la sesión, preferencias, ajustes de notificación, datos temporales del editor y borradores de recuperación.

### 5.2. Supabase

AGENDA STAFF utiliza Supabase como infraestructura de autenticación y base de datos para las funciones compartidas, como eventos, firmas y plantillas PDF. La información necesaria se transmite mediante conexiones HTTPS.

Supabase actúa como proveedor técnico de infraestructura. Sus prácticas de privacidad pueden consultarse en:

<https://supabase.com/privacy>

### 5.3. Usuarios autorizados

Determinados datos operativos, especialmente firmas y plantillas compartidas, pueden estar disponibles para otros usuarios autorizados de AGENDA STAFF dentro de la organización. Los usuarios deben disponer de autorización para incorporar y utilizar datos de terceros.

## 6. Permisos del navegador

AGENDA STAFF solicita permisos de Chrome únicamente para proporcionar sus funciones:

- **Panel lateral:** mostrar la interfaz principal de la extensión.
- **Almacenamiento:** conservar sesión, preferencias y borradores.
- **Pestaña activa y scripting:** ejecutar capturas o selectores iniciados por el usuario y mostrar indicadores de firmas en Gmail.
- **Menú contextual:** permitir enviar a AGENDA STAFF un texto seleccionado por el usuario.
- **Notificaciones:** mostrar recordatorios de agenda.
- **Documento fuera de pantalla:** reproducir el sonido local de los recordatorios.
- **Acceso a sitios:** comunicarse con el servicio de datos, analizar localmente Gmail y actuar sobre una página únicamente cuando el usuario inicia una captura o recorte.

Estos permisos no se utilizan para recopilar el historial de navegación ni para realizar seguimiento publicitario.

## 7. Código remoto

La extensión no descarga ni ejecuta código JavaScript o WebAssembly alojado de forma remota. Las librerías necesarias están incluidas en el paquete distribuido a través de Chrome Web Store. Las conexiones externas se utilizan para intercambiar datos mediante API, no para obtener código ejecutable.

## 8. Conservación y eliminación

- Los datos locales permanecen en el navegador hasta que el usuario cierra sesión, elimina los datos de la extensión o la desinstala.
- Los eventos, firmas y plantillas sincronizados se conservan mientras sean necesarios para la operativa o hasta que un usuario autorizado los elimine.
- Los archivos exportados se guardan en la ubicación elegida por el usuario y quedan bajo su control.

Para solicitar acceso, rectificación o eliminación de información asociada a la cuenta, contacte con el editor mediante el canal indicado en el apartado 1. La solicitud podrá requerir una comprobación razonable de identidad y autorización.

## 9. Seguridad

La extensión utiliza conexiones HTTPS, autenticación mediante tokens de sesión y controles de acceso del servicio de datos. No obstante, ningún sistema ofrece seguridad absoluta. Los usuarios deben proteger sus credenciales, cerrar sesión en equipos compartidos y evitar cargar datos para los que no tengan autorización.

## 10. Menores de edad

AGENDA STAFF está destinada a la gestión profesional y no se dirige a menores de edad. No se recopilan conscientemente datos de menores para finalidades comerciales.

## 11. Venta, publicidad y transferencias no relacionadas

AGENDA STAFF:

- No vende datos personales.
- No comparte datos con redes publicitarias.
- No utiliza datos para publicidad personalizada.
- No utiliza datos para determinar solvencia, conceder préstamos o seguros.
- No transfiere información para finalidades ajenas a las funciones descritas en esta política.

## 12. Cambios en esta política

Esta Política de Privacidad puede actualizarse para reflejar cambios funcionales, legales o de seguridad. La fecha de la última actualización aparecerá al comienzo del documento. Los cambios materiales se publicarán en este mismo enlace.

