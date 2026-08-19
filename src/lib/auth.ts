/**
 * Identidad. **Solo servidor.**
 *
 * LA REGLA, y es la que de verdad importa: el `userId` SIEMPRE se deriva aquí,
 * de la petición. Nunca se acepta como parámetro de una server function, ni
 * aunque el cliente lo mande. El riesgo realista en una app así no es una
 * inyección de SQL —drizzle parametriza todo— sino que alguien cambie un id en
 * el cuerpo de la petición y lea los datos de otra persona. Por eso ninguna
 * función de src/lib/server/ recibe userId: lo piden a `usuarioActual()`.
 *
 * En producción, Cloudflare Access valida la identidad ANTES de que la petición
 * llegue al Worker e inyecta la cabecera `Cf-Access-Authenticated-User-Email`.
 * Aun así no se confía a ciegas: si Access no está configurado, la app no debe
 * abrirse sola al mundo. De ahí `AUTH_MODO`.
 */
import { eq } from "drizzle-orm";
import { getRequestHeader } from "@tanstack/react-start/server";
import { getDb } from "./db/client";
import { envCloudflare } from "./db/env";
import { user, profile } from "./db/schema";

/** Plantilla de plato por defecto para un usuario nuevo, en unidades de mano. */
const PLANTILLA_POR_DEFECTO = {
  desayuno: { proteina: 2, verdura: 1, carbohidrato: 0, grasa: 1 },
  comida: { proteina: 2, verdura: 2, carbohidrato: 1, grasa: 1 },
  snack: { proteina: 1, verdura: 0, carbohidrato: 0, grasa: 1 },
  cena: { proteina: 2, verdura: 2, carbohidrato: 0, grasa: 1 },
};

export class NoAutenticado extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "NoAutenticado";
  }
}

/**
 * Correo del usuario de la petición en curso, o null.
 *
 * Se lee por petición y nunca se memoriza en un módulo: cachearlo sería un bug
 * de aislamiento entre usuarios el día que este deploy sirva a más de una
 * persona. (Los *bindings* sí se guardan en global — ver db/env.ts — porque son
 * del Worker, no de la petición.)
 */
export function correoDeLaPeticion(): string | null {
  const env = envCloudflare();

  /* Access inyecta DOS cosas al pasar una petición al origen, y no son
     equivalentes: `Cf-Access-Jwt-Assertion` es la documentada y garantizada;
     `Cf-Access-Authenticated-User-Email` es cómoda pero no aparece en la
     referencia de Access. Leer solo la segunda arriesgaba quedarse fuera de la
     app desplegada sin más síntoma que "Sin identidad". Se prueban las dos. */
  const deCabecera = getRequestHeader("cf-access-authenticated-user-email");
  if (deCabecera) return deCabecera;

  const jwt = getRequestHeader("cf-access-jwt-assertion");
  if (jwt) {
    const email = correoDelJwt(jwt);
    if (email) return email;
  }

  // Sin Access enfrente: solo se permite el correo declarado explícitamente en
  // la configuración. Nunca un valor que venga de la petición.
  const modo = (env as { AUTH_MODO?: string } | undefined)?.AUTH_MODO;
  const dev = env?.DEV_USER_EMAIL;
  if (modo === "abierto" && dev) return dev;

  // En `npm run dev` no hay env de Cloudflare en absoluto.
  if (!env) return process.env["DEV_USER_EMAIL"] ?? "dev@localhost";

  return null;
}

/**
 * Extrae el correo del JWT que inyecta Access.
 *
 * LIMITACIÓN CONOCIDA, y conviene que sea explícita: esto DECODIFICA el token,
 * no verifica su firma. Verificarla en condiciones implica traer las llaves
 * públicas de `https://<tu-equipo>.cloudflareaccess.com/cdn-cgi/access/certs` y
 * comprobar RS256 en cada petición.
 *
 * Es aceptable aquí porque Access es la ÚNICA ruta hacia el Worker: nadie puede
 * llegar al origen sin pasar por él, así que no hay por dónde inyectar un token
 * falso. Deja de ser aceptable el día que expongas el Worker por otra ruta —un
 * dominio propio sin política, otro route— porque entonces cualquiera podría
 * mandar la cabecera a mano. Si haces eso, verifica la firma primero.
 */
function correoDelJwt(jwt: string): string | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    // base64url → base64, con el relleno que atob exige.
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    const datos = JSON.parse(json) as { email?: string };
    return datos.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Devuelve el id del usuario de la petición, creándolo la primera vez.
 *
 * El alta implícita es correcta en el modelo self-host: si Access dejó pasar la
 * petición, esa persona es la dueña de la instancia. En un despliegue
 * multi-usuario habría que sustituir esto por un alta explícita.
 */
export async function usuarioActual(): Promise<{ id: string; email: string }> {
  const email = correoDeLaPeticion();
  if (!email) {
    throw new NoAutenticado(
      "Sin identidad. Pon Cloudflare Access enfrente del Worker, o define " +
        "DEV_USER_EMAIL y AUTH_MODO=abierto para correr sin autenticación.",
    );
  }

  const db = await getDb();
  const existente = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (existente[0]) return { id: existente[0].id, email };

  const id = crypto.randomUUID();
  await db.insert(user).values({ id, email });
  await db.insert(profile).values({
    userId: id,
    plantillaPlato: JSON.stringify(PLANTILLA_POR_DEFECTO),
  });
  return { id, email };
}
