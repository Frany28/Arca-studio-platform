// Guardia de arranque: los puntos de entrada lo importan justo después de cargar
// el entorno y antes que la aplicación. Como los módulos ES se evalúan en orden
// de importación, una configuración insegura lanza aquí y ningún módulo llega a
// atender solicitudes. En Vercel la función queda sin inicializar y el error
// aparece en los logs; en local el proceso termina con código distinto de cero.
import { assertSecureEnvironment } from "./environment.js";

assertSecureEnvironment();
