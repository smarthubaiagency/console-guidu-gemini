// Copiar para tests/core/__MODULE_KEY__.test.ts e completar.
// Referência completa: tests/core/modules-hello-world.test.ts.
//
// Casos obrigatórios (Adendo §9 e §15):
// - módulo desabilitado no workspace bloqueia os serviços sem gravar nada;
// - papel sem permissão recebe PermissionDeniedError;
// - workspace B não lê nem acessa por id os dados do workspace A;
// - limite atingido devolve conflito;
// - manutenção global bloqueia o módulo;
// - mudanças críticas geram audit_events.
export {};
