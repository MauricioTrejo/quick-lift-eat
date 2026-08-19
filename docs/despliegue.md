# Desplegar en Cloudflare

Guía paso a paso, de una máquina limpia a una app funcionando en internet y protegida.

**Tiempo:** unos 30 minutos la primera vez. **Costo:** $0 — todo cabe en el free tier. Lo único de pago es la API de Anthropic, y solo si usas los agentes.

Cada paso dice **cómo saber que salió bien** antes de seguir al siguiente. Si algo falla, no continúes: los errores de despliegue se vuelven muy difíciles de diagnosticar cuando se apilan.

---

## Antes de empezar

Necesitas una cuenta de Cloudflare (gratuita) y el repo en tu máquina con `npm install` hecho.

```bash
npx wrangler login
```

Abre el navegador y pide permiso. Al volver:

```bash
npx wrangler whoami
```

**Cómo saber que salió bien:** imprime tu correo y tu Account ID. Si dice que no estás autenticado, repite el `login`.

---

## Paso 1 · Crear la base de datos

```bash
npm run db:create
```

Devuelve algo así:

```
✅ Successfully created DB 'quick-lift-eat'
[[d1_databases]]
binding = "DB"
database_name = "quick-lift-eat"
database_id = "a1b2c3d4-...-...."
```

**Copia ese `database_id`** y pégalo en `wrangler.jsonc`, reemplazando el marcador:

```jsonc
"database_id": "PENDIENTE-CORRE-npm-run-db:create"   // ← sustitúyelo
```

Ese id **no es un secreto** — es un identificador, no una credencial — y por eso el archivo se versiona.

**Cómo saber que salió bien:** `grep database_id wrangler.jsonc` ya no dice `PENDIENTE`.

---

## Paso 2 · Crear las tablas

```bash
npm run db:migrate:remote
```

Aplica las tres migraciones (esquema, plantilla de plato, vistas) contra la D1 de Cloudflare, no contra la local.

**Cómo saber que salió bien:**

```bash
npx wrangler d1 execute quick-lift-eat --remote --command "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
```

Debe devolver **24**. Si devuelve 0 o falla, la migración no llegó.

---

## Paso 3 · Sembrar el catálogo

```bash
npm run db:seed -- --remote
```

Carga los 11 patrones de movimiento, 56 ejercicios, 36 alimentos y 9 presets. Es idempotente: correrlo dos veces no duplica nada.

**Cómo saber que salió bien:**

```bash
npx wrangler d1 execute quick-lift-eat --remote --command "SELECT (SELECT COUNT(*) FROM exercise) ejercicios, (SELECT COUNT(*) FROM food_item) alimentos;"
```

Debe decir **56 y 36**. Sin esto la app arranca pero no puedes importar ningún plan: todo `exerciseId` sería desconocido.

---

## Paso 4 · Compilar y desplegar

```bash
npm run build
```

Antes de subir nada, ensaya el despliegue sin ejecutarlo:

```bash
npx wrangler deploy --dry-run -c .output/server/wrangler.json
```

**Cómo saber que salió bien:** al final imprime los bindings y debe aparecer `env.DB (quick-lift-eat) · D1 Database`. Si el binding no sale, el `database_id` del paso 1 no quedó bien puesto — vuelve ahí antes de seguir.

Ahora sí:

```bash
npx wrangler deploy -c .output/server/wrangler.json
```

Te devuelve la URL: `https://quick-lift-eat.<tu-subdominio>.workers.dev`

**Cómo saber que salió bien:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://quick-lift-eat.<tu-subdominio>.workers.dev/
```

Debe responder **200**. Si abres esa URL en el navegador verás la app… **y cualquiera en internet también.** Eso se arregla en el paso siguiente, y es el paso que no puedes saltarte.

---

## Paso 5 · Poner Cloudflare Access delante

Sin esto tu app es pública. Con esto, nadie que no seas tú llega siquiera al Worker.

1. En el panel de Cloudflare, entra a **Zero Trust → Access → Applications**.
2. **Add an application → Self-hosted.**
3. **Application domain:** el hostname exacto del Worker, sin `https://` ni barra final:
   `quick-lift-eat.<tu-subdominio>.workers.dev`
4. Crea una política: **Action: Allow**, e incluye **Emails → tu correo**. (También sirve _Login Methods_ o _Emails ending in_ si prefieres.)
5. Guarda.

**Cómo saber que salió bien:** abre la URL en una ventana de incógnito. Debe pedirte iniciar sesión antes de mostrar nada. Si entras directo, la política no está aplicada — revisa que el hostname coincida carácter por carácter.

> **Sobre `workers.dev` y Access.** La documentación de Cloudflare confirma que se puede: _"To require visitors to sign in before they can access a `workers.dev` URL, use Cloudflare Access."_ Eso sí, Cloudflare considera `workers.dev` un sitio gratuito «pensado para proyectos personales o de afición, no críticos para el negocio», y recomienda dominio propio para producción. Para una app de entrenamiento personal, `workers.dev` está bien.

### Si prefieres dominio propio

Un dominio en Cloudflare (~$10/año) te da una URL decente y te saca de la advertencia anterior. Añade un **Custom Domain** al Worker y crea la política de Access sobre ese hostname.

**Importante si haces esto:** el Worker queda accesible por **dos** rutas. Pon la política de Access sobre las dos, o desactiva la URL `workers.dev` — si no, la ruta sin proteger es una puerta abierta que anula todo lo demás.

---

## Paso 6 · La llave de Anthropic (opcional)

Solo si vas a usar los agentes. Sin ella, todo lo demás funciona: importar plan, registrar entrenos, registrar comidas.

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Pega la llave cuando la pida. **Nunca va en `wrangler.jsonc`** — ese archivo se versiona en un repo público.

**Cómo saber que salió bien:**

```bash
npx wrangler secret list
```

Debe listar `ANTHROPIC_API_KEY`. El valor no se puede volver a leer, ni tú ni nadie: si lo pierdes, se regenera y se vuelve a subir.

---

## Paso 7 · La primera prueba

Abre la URL, inicia sesión con Access, y en la app:

1. **Cargar un plan → Importar JSON → Usar el plan de ejemplo → Importar.**
2. Si hoy es día de entreno, registra una serie.
3. Comprueba que persiste:

```bash
npx wrangler d1 execute quick-lift-eat --remote --command "SELECT (SELECT COUNT(*) FROM user) usuarios, (SELECT COUNT(*) FROM plan) planes, (SELECT COUNT(*) FROM set_log) series;"
```

Si `usuarios` es 1, Access te identificó correctamente y la app te dio de alta sola.

---

## Cuando algo sale mal

| Síntoma                                                    | Causa casi segura                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Sin identidad"** en la app                              | Access no está aplicado sobre ese hostname, o la política no incluye tu correo. La app falla cerrada a propósito: sin identidad no se abre. |
| **"Falta ANTHROPIC_API_KEY"** al generar un plan           | El secreto no está puesto (paso 6). El resto de la app sigue funcionando.                                                                   |
| **"Estos ejercicios no están en el catálogo"** al importar | Falta el paso 3 en remoto. Corre `npm run db:seed -- --remote`.                                                                             |
| **Error de D1 / "no such table"**                          | Falta el paso 2 en remoto, o el `database_id` apunta a otra base.                                                                           |
| **El binding no aparece en el dry-run**                    | El `database_id` sigue en `PENDIENTE` o quedó mal pegado.                                                                                   |
| **La app se ve pero sin plan**                             | Normal: la base remota arranca vacía. La local y la remota son bases distintas y no se sincronizan.                                         |

### Volver atrás

```bash
npx wrangler deployments list       # historial de despliegues
npx wrangler rollback               # vuelve al anterior
```

El rollback revierte el **código**, no la base de datos. Una migración ya aplicada sigue aplicada; si necesitas deshacerla, escribe una migración nueva que la revierta.

---

## Lo que este despliegue NO hace

Vale la pena tenerlo claro para no confiar de más:

- **La firma del JWT de Access no se verifica.** La app decodifica el token que inyecta Access para sacar tu correo, pero no comprueba su firma criptográfica. Es aceptable porque Access es la única ruta hacia el Worker: nadie llega al origen sin pasar por él. **Deja de serlo si expones el Worker por otra ruta sin política** — entonces cualquiera podría mandar la cabecera a mano. Ver `src/lib/auth.ts`.
- **La base local y la remota son independientes.** Nada se copia solo en ninguna dirección.
- **No hay respaldos automáticos.** D1 guarda _Time Travel_ 30 días, así que un borrado accidental es recuperable dentro de esa ventana:
  ```bash
  npx wrangler d1 time-travel info quick-lift-eat      # a qué momentos puedes volver
  npx wrangler d1 time-travel restore quick-lift-eat --timestamp <marca>
  ```
  Aun así, exporta de vez en cuando — 30 días pasan rápido:
  ```bash
  npx wrangler d1 export quick-lift-eat --remote --output respaldo.sql
  ```
- **No hay CI.** Cada despliegue es manual: `npm run build` y `wrangler deploy`.
- **Los agentes nunca se han probado contra la API real.** Cuando generes tu primer plan, `npm run db:llm` —cambiando `--local` por `--remote`— te dará la primera medición de costo y latencia.
