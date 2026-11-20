// D-62: modo de despliegue para deploy.yml con el mismo criterio que el guard y launch:readiness (isClosedDeploy), sin duplicarlo.
// Corre sin npm ci: Node 22 quita los tipos y env-policy.ts no importa nada.
import { readFileSync } from 'node:fs';
import { isClosedDeploy } from '../src/config/env-policy.ts';
console.log(`closed_deploy=${isClosedDeploy(JSON.parse(readFileSync(new URL('../config/launch.json', import.meta.url), 'utf8')))}`);
