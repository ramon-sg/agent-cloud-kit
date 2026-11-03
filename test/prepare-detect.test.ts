/**
 * @file Tests for `prepare` preflight checks.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { preflight } from "../src/prepare/detect.ts";

const OK = { isTty: true, gitRoot: "/r", hasOrigin: true, claudeHelp: "Usage: claude --cloud" };

test("preflight is empty when everything is fine", () => {
  assert.deepEqual(preflight(OK), []);
});

test("preflight reports each problem", () => {
  assert.deepEqual(preflight({ ...OK, isTty: false }), ["prepare necesita una terminal interactiva (corre el comando directamente en tu terminal)"]);
  assert.deepEqual(preflight({ ...OK, gitRoot: undefined }), ["esto no es un repositorio git; corre prepare dentro del repo"]);
  assert.deepEqual(preflight({ ...OK, hasOrigin: false }), ["el repositorio no tiene el remoto 'origin'; prepare necesita subir una rama a GitHub"]);
  assert.deepEqual(preflight({ ...OK, claudeHelp: undefined }), ["claude no está instalado o no está en el PATH; instala Claude Code y vuelve a correr prepare"]);
  assert.deepEqual(preflight({ ...OK, claudeHelp: "Usage: claude" }), ["tu versión de claude no soporta --cloud; actualiza Claude Code y vuelve a correr prepare"]);
});

test("preflight names the command it checks for", () => {
  assert.deepEqual(preflight({ ...OK, isTty: false }, "verify"), ["verify necesita una terminal interactiva (corre el comando directamente en tu terminal)"]);
});

test("preflight collects several problems in order", () => {
  assert.equal(preflight({ ...OK, isTty: false, hasOrigin: false }).length, 2);
});
