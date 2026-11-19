# Dos worktrees de trabajo

M3: contenido y estructura, `http://localhost:4393`. M4: diseño y medios, `http://localhost:4394`. Cada carpeta tiene `.env.worktree` privado con su `EMDASH_SITE_URL`; ambos usan la misma base Astro y estados locales independientes. No usar el ZIP de la antigua PR como fuente de desarrollo.

# Levantar Astro y el CMS reales

Desde esta carpeta, con Node 22.22.2:

```sh
npm ci
npm run local:worker
```

Abre `/interno/m3/inicio/` en el origen de tu worktree para revisar las siete páginas. El panel nativo de EmDash está en `/_emdash/admin/` en ese mismo origen. El estado es local y no se incluye en GitHub. Para tu propia cuenta editorial, sigue las instrucciones de estado aislado del README.

Para desarrollo usa `npm run dev`, en el mismo puerto configurado. Detén un servidor antes de iniciar el otro dentro de ese worktree; M3 y M4 pueden ejecutarse a la vez en sus puertos separados.

# Actualizar los HTML

Con el Worker activo y el build actualizado:

```sh
npm run export:presentation
```

Los HTML de la nueva revisión se generan en `.private/review-html/`, excluidos de Git. El ZIP y los HTML ya publicados pertenecen a la entrega anterior y no se sobrescriben por esta revisión local. El paquete no exporta el backend del CMS ni despliega servicios externos. Las páginas legales y el copy M4 siguen pendientes de aprobación.
