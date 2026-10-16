# Contrato das análises do local (GB1a e GB1b)

GB1a e GB1b foram feitas em paralelo. Este contrato separa os lados.

| Arquivo                                               | Dono    |
| ----------------------------------------------------- | ------- |
| `src/modules/google-business/analyses/contract.ts`    | Os dois |
| `src/modules/google-business/analyses/registry.ts`    | Os dois |
| `src/modules/google-business/analyses/deterministic/` | GB1a    |
| `src/modules/google-business/analyses/intelligence/`  | GB1b    |

- A GB1a lê a ficha, cria a unidade e o `gb_location`, roda cada análise do registro na fase certa, grava o resultado (`AnalysisResult`) e mostra os achados na página de automação. As análises `blocking` terminam antes de a janela de onboarding fechar; as `background` continuam e a área aparece "em andamento".
- A GB1b entrega as análises inteligentes (sugestões da IA por área, com a chave da plataforma, e a saúde no Maps). Os dados próprios dela (palavras-chave, concorrentes, medições do mapa) ficam em tabelas ligadas à unidade (`workspace_locations.id`), não ao `gb_location`, para não depender da migration da GB1a.
- Textos sempre por chave de tradução (`titleKey`, `detailKey`, `labelKey`), nos três idiomas.
- Mudar `contract.ts` ou `registry.ts` exige combinar os dois lados.
