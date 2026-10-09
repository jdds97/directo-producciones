# Abrir la presentación

Descarga `directo-preview.zip` de la rama `jdds97/M4-Astro-Integracion`, extrae el ZIP y abre `preview-html/index.html` en Chrome, Firefox o Edge. No hace falta Node ni servidor. El contenido es borrador de presentación; el formulario está deshabilitado.

# Levantar Astro y el CMS reales

Desde esta carpeta, con Node 22.22.2:

```sh
npm ci
npm run local:worker
```

Abre `http://localhost:4394/`. El panel nativo de EmDash está en `http://localhost:4394/_emdash/admin/`. El estado es local y no se incluye en GitHub. Para tu propia cuenta editorial, sigue las instrucciones de estado aislado del README.

Para desarrollo usa `npm run dev`, también en el puerto 4394. Detén un servidor antes de iniciar el otro.

# Actualizar los HTML

Con el Worker activo y el build actualizado:

```sh
npm run export:presentation
```

Los archivos se regeneran en `preview-html/`. El paquete no exporta el backend del CMS ni despliega servicios externos. Las páginas legales y el copy M4 siguen pendientes de aprobación.
