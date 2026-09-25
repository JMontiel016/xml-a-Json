# XML a nota de crédito · React + Vercel

Proyecto web independiente. La conversión se ejecuta en una función Python de Vercel y no requiere Java, Docker ni servidores propios después de publicar.

## Prueba local

En dos terminales dentro de esta carpeta:

```bash
# Terminal 1 (API Python, puerto 8766)
API_PORT=8766 python3 local_server.py
```

```bash
# Terminal 2 (web React, puerto 3005)
npm install
API_PORT=8766 npm run dev -- --port 3005
```

Abrí **http://127.0.0.1:3005/**. Podés elegir otros números libres: poné el **mismo `API_PORT` en ambas terminales** y cambiá `--port 3005` al puerto que prefieras para la web. La carpeta seleccionada se lee en el navegador y solo muestra XML/TXT. El servidor recibe el XML elegido; no guarda los documentos. Las marcas de realizado se guardan solo en ese navegador.

## Publicación en Vercel

1. Subí **esta carpeta** a un repositorio Git o importala desde tu equipo con la CLI de Vercel.
2. En Vercel: **Add New → Project**; elegí el repositorio y usá `xml-nc-vercel` como Root Directory si el repositorio contiene otras carpetas.
3. Framework Preset: **Vite**. Build Command: `npm run build`. Output Directory: `dist`.
4. Para habilitar **Acceso y envío**, agregá la variable `INTEGRATION_ALLOWED_HOST` en Project Settings → Environment Variables. Su valor debe ser solo el dominio del servicio de integración, sin `https://` ni ruta. Configurala en Production y Preview según corresponda. No coloques RUC, contraseña ni token en variables o archivos del proyecto.
5. Publicá y probá primero con un XML de factura y una NC borrador. Verificá los importes antes de usar el envío.

Desde la CLI también podés publicar desde esta carpeta con `npx vercel` y, cuando estés conforme con la vista previa, `npx vercel --prod`. Se necesita iniciar sesión en tu propia cuenta de Vercel.

**Envío:** las funciones `/api/send` aceptan únicamente HTTPS y el dominio configurado. Devuelven la respuesta HTTP del servicio sin almacenar credenciales. El servicio de destino debe ser accesible desde los servidores de Vercel. La web queda accesible a quien tenga la URL; si contiene datos sensibles o se usará por varios usuarios, configurá protección de acceso antes de compartirla.

**Comparación:** se comprobó la salida JSON contra el código Java original con una factura exenta, tanto NC completa como parcial por monto. Probá tus XML y combinaciones de IVA en la vista previa antes de enviar documentos reales.
