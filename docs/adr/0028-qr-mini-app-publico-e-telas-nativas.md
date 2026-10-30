# ADR 0028 — QR abre a rota pública do mini-app, e quem tem o app usa telas nativas

- **Status:** Proposto; vira aceito com a aprovação do Marcelo no PR
- **Data:** 30/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** decisão do Marcelo de 30/10/2026, na conversa sobre a página do local e a página de produto do guidu.chat
- **Ajusta:** [ADR 0027](0027-guidu-chat-v1-console-bridge.md), só na seção 3 e na consequência sobre o app nativo. O restante dela continua valendo
- **Relaciona-se com:** [mini-apps-bridge.md](../architecture/mini-apps-bridge.md), [contrato do Cliente Hub](../modules/cliente-hub/contrato.md), [equipes-guidu-chat-v1.md](../gestao/equipes-guidu-chat-v1.md)

## Contexto

A ADR 0027 define dois pontos que este documento revê:

- `guidu.chat/q/<código>` resolve a entrada e abre Locais, com o produto no iframe.
- O perfil completo, o produto ou oferta, o catálogo e o cardápio são mini-apps, abertos por iframe no web e por WebView no app.

Com isso, quem lê um QR precisa carregar o guidu.chat antes de ver o produto, e quem tem o app veria o perfil da loja em WebView. O [mini-apps-bridge.md](../architecture/mini-apps-bridge.md) já descrevia outro caminho: o QR abre o runtime direto no navegador, sem o app instalado, e o link universal abre o app se ele estiver instalado. A ADR 0027 prevaleceu sobre esse trecho.

Em 30/10/2026 o Marcelo aprovou o modelo do perfil da loja, que no guidu.chat web virou a tela `/locais/{slug}`, feita com os componentes do `@guiduchat/ui` 0.7.0. Ao discutir a página de produto, definiu como cada pessoa deve chegar a essas telas.

**Alternativas que caíram:**

- **Manter a ADR 0027:** a primeira visita pelo QR continuaria passando pelo guidu.chat e por um iframe.
- **Produto como tela do guidu.chat:** tiraria do console um mini-app que já está no cronograma da semana de 10/11.
- **Tudo em WebView no app:** daria uma experiência pior justamente a quem instalou.

## Decisão

Decidido pelo Marcelo em 30/10/2026.

1. **O código do QR não muda.** O impresso continua `guidu.chat/q/<código>`, para o QR não depender do endereço de cada mini-app. Só muda o que acontece depois da leitura:

   | Quem lê o QR        | O que abre                                                                                                          |
   | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
   | Tem o app instalado | O app, pelo link universal, no produto ou na oferta                                                                 |
   | Não tem o app       | Redirecionamento para a rota pública do mini-app (`apps.guidu.chat/<loja>/<item>`), no navegador, sem instalar nada |

2. **Produto ou oferta continua mini-app** da equipe console, como na ADR 0027. No app, abre em WebView. No navegador, abre direto pela rota pública. Dentro do guidu.chat web, pelo iframe.
3. **Quem tem o app vê o perfil da loja em tela nativa**, sem WebView.
4. **O perfil da loja existe em três lugares, com os mesmos dados:** tela nativa no app, tela `/locais/{slug}` no guidu.chat web e mini-app de perfil na rota pública. Web e mini-app usam os componentes do `@guiduchat/ui`; o app usa os mesmos tokens e ícones.
5. **Na rota pública não há ponte nem login:** o mini-app fica em modo visitante, só com dados publicados, como já prevê o [mini-apps-bridge.md](../architecture/mini-apps-bridge.md).
6. **Chat, carrinho, salvar e pedido ficam só no app e no guidu.chat web**, que têm a sessão da pessoa. Na rota pública, essas ações levam ao app ou ao guidu.chat web, mantendo loja, item e origem no contexto comercial do servidor. O token do turista continua fora do mini-app.
7. **O restante dos mini-apps não muda:** catálogo, cardápio e área da loja continuam como na ADR 0027.

## Consequências

- **Equipe console:** a resolução de `guidu.chat/q/<código>` passa a redirecionar para a rota pública quando o app não abre. O mini-app de perfil e o de produto usam o `@guiduchat/ui`.
- **Contrato:** o perfil precisa de um formato único para `GET /stores/{slug}`, que serve às três superfícies. O mini-app de perfil e as telas do guidu.chat leem os mesmos campos.
- **Equipe guidu.chat:** o link universal e o link de app entram no app nativo e no host `guidu.chat`. A página do local deixa de ter o botão "Ver local", porque ela já é o perfil completo.
- **Janeiro:** o caminho pelo navegador cobre o piloto. As telas nativas vêm depois, e a estreia não depende delas.
- **Custo:** o perfil tem três montagens de tela. Os componentes e os dados são compartilhados, mas mudança no layout exige ajuste em cada uma.
- **Reversível:** sim. Como o QR impresso não muda, voltar ao fluxo da ADR 0027 só exige trocar a resolução no servidor.
