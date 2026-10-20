# Templates Digitais no GUIDU

- **Versão:** 0.1, 20/10/2026.
- **Estado:** proposta para revisão de produto e arquitetura; nenhuma implementação ou migration nesta entrega.
- **Branch:** `codex/digital-templates-platform-plan`.
- **Base auditada do GUIDU:** `29e47607410b360a7b9e594682ac185cabf30323`.
- **Fonte:** `linkkotech/nextcrm-primeiro`, HEAD local `5875e03744a847ee73f9af01dcded46989fbdcc1`, com alterações locais ainda não versionadas.

## Resultado

É tecnicamente viável migrar o ecossistema de Templates Digitais como módulo do monólito modular GUIDU. A recomendação é concentrar a autoria de design em `/platform`, distribuir versões publicadas e imutáveis e deixar `/admin` e `/app` como consumidores. O preenchimento de dados não dá acesso à estrutura, ao tema ou ao editor.

Essa política foi sugerida pelo solicitante em 20/10/2026 e é a hipótese avaliada aqui. Ela modifica decisões do planejamento atual de Perfil digital; não deve ser tratada como alteração já aprovada dos documentos anteriores.

O código de origem oferece um editor extenso, mas ainda não entrega sozinho o ciclo completo de publicação e renderização pública. A migração é uma extração seletiva e uma conclusão de produto, não apenas uma movimentação de pastas.

## Documentos

1. [Análise de viabilidade](analise-viabilidade.md): inventário, evidências, lacunas, conflitos e riscos.
2. [Especificação candidata do módulo](MODULE_SPEC.md): limites, papéis, dados, interfaces e comportamento propostos.
3. [Plano completo de implantação](plano-de-implantacao.md): etapas, dependências, aceite, testes, branches, estimativa e operação.

## Decisões recomendadas

- Plataforma cria, edita, duplica e publica designs e blocos. Admin e app não têm operações de autoria, mesmo em modo gerenciado.
- O catálogo e seu editor pertencem a `digital-templates`. Perfis, unidades, dados pessoais e endereços continuam em `digital-profile` e no núcleo competente.
- Cada vínculo usa uma versão publicada específica. Uma versão nova não altera os usos existentes automaticamente.
- O parceiro consulta o catálogo que lhe foi disponibilizado. Distribuir para seus clientes exige permissão própria e um caminho explícito de delegação, sem abrir os dados do workspace por consequência.
- O workspace recebe a versão autorizada e preenche os dados permitidos pelo módulo consumidor. Não recebe um construtor genérico de formulários ou campos de design.
- O editor pode ser entregue antes da rota pública, mas a migração completa só termina com publicação, mídia real, dados reais autorizados, importação validada, operação e recuperação verificadas.

## O que esta entrega fez

Leitura do código local e das referências do GUIDU, proposta documental em branch dedicada e definição de critérios verificáveis. Não foram consultados bancos, arquivos de segredo ou ambientes de produção. Não foram executados testes de aplicação nem afirmada equivalência visual em navegador.

## Histórico

| Versão | Data       | Mudança                                                                           |
| ------ | ---------- | --------------------------------------------------------------------------------- |
| 0.1    | 20/10/2026 | Viabilidade e plano para autoria exclusiva da plataforma e consumo por admin/app. |
