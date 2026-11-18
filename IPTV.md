# IPTV no DriveFlin com Jellyfin (versão inicial)

Esta branch adiciona **TV ao vivo M3U** ao backend compatível com Jellyfin do repositório `nelton10/drive-nelton`. O Google Drive, as bibliotecas existentes e o sistema de login continuam no projeto.

## Configurar IPTV com uma única URL na Cloudflare (recomendado)

1. Acesse **Cloudflare Dashboard → Workers & Pages → seu Worker → Settings → Variables and Secrets**.
2. Crie **um único Secret** chamado `IPTV_PLAYLIST_URL` e cole como valor a **URL M3U completa** fornecida por seu provedor (incluindo os parâmetros de autenticação, caso existam).
3. Salve e publique as configurações no ambiente usado pelo Worker.
4. Abra `https://SEU-WORKER.workers.dev/iptv` com a conta de administrador e clique em **Atualizar IPTV pela Cloudflare**.
5. O Worker busca a lista e atualiza até 1.500 canais no D1. Em falhas, mantém o catálogo anterior.

Não é necessário definir `IPTV_SERVER_URL`, `IPTV_USERNAME`, `IPTV_PASSWORD` nem `IPTV_OUTPUT`. A URL é lida diretamente do Secret, não é exibida no painel, gravada em `IptvSources` nem incluída no GitHub.

**Segurança:** os endereços dos canais individuais recebidos do provedor continuam no D1 e podem conter credenciais. O player atual usa redirecionamentos, portanto esses endereços podem ficar visíveis nos dispositivos. A alteração **não** implementa um proxy privado de streaming. Use apenas provedores que você tem autorização para acessar e evite compartilhar a instalação.

## Como cadastrar

1. Implante esta branch em uma instalação **de teste** no Cloudflare Workers, com o D1 `DB` configurado. A branch principal não é alterada.
2. Entre com seu usuário de administrador no endereço `https://SEU-SITE.workers.dev/setup`.
3. Clique em **Gerenciar IPTV (M3U)** ou abra diretamente `https://SEU-SITE.workers.dev/iptv`.
4. Digite o nome da lista e a URL HTTP(S) M3U, ou cole o conteúdo `#EXTM3U`. Clique em **Importar lista**.
5. Use **Abrir canais de TV** ou a área **TV ao vivo** do Jellyfin. A lista é guardada em tabelas próprias no D1 e persiste entre reinicializações.

O gerenciamento está protegido por autenticação de **administrador** (HTTP Basic, já presente no DriveFlin).
A API `GET /LiveTv/Channels` e `GET /LiveTv/Channels/:id` é compatível com a descoberta inicial de canais do Jellyfin; `GET /Items/:id/PlaybackInfo` também reconhece os canais.

## Limitações importantes

- **Não há transcodificação no Cloudflare Workers.** Reprodução depende do protocolo, codecs e CORS do provedor/aparelho.
- Os links originais são acessados por redirecionamento HTTP; isso **expõe URLs e eventuais credenciais IPTV ao aparelho**, mesmo que o JSON de canais não as retorne. Não compartilhe o servidor com terceiros.
- A importação rejeita redirecionamentos na busca da lista, endereços privados literais e URLs sem HTTP(S), mas **não oferece validação completa de DNS/SSRF**. Só administradores confiáveis devem configurar URLs.
- Até 1.500 itens por lista e 2 MB por importação. Provedores podem exigir cabeçalhos, cookies, referer ou formatos que este player não suporta.
- Este passo **não inclui** login Xtream Codes separado, atualização automática de playlists, XMLTV/EPG, DVR/gravação ou extração organizada de filmes/séries VOD. Essas melhorias exigem novas rotas e testes de cliente.
- A integração com a interface Jellyfin ainda **não foi testada em TV, celular nem Cloudflare real** e não tem garantia de funcionamento em todos os aplicativos.
- Faça backup do D1 antes de substituir a instalação existente. Não publique credenciais IPTV no GitHub; salve apenas pelo painel de administração.

## Rotas adicionadas

- `/iptv`: importação e exclusão de listas (admin)
- `/iptv/watch`: lista de canais (admin)
- `/LiveTv/Info`: descoberta de TV ao vivo
- `/LiveTv/Channels` e `/LiveTv/Channels/:id`: catálogo Jellyfin
- `/Items/:id/PlaybackInfo`: descrição da fonte de vídeo para o player
- `/Videos/:id/stream.ts` e `/Videos/:id/master.m3u8`: acesso direto mediante sessão Jellyfin
- `/api/iptv/channels`: lista JSON autenticada

## Licença e atribuição

A base do projeto continua sujeita à licença do repositório original. Utilize somente playlists que você tenha autorização para acessar.
