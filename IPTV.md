# IPTV no DriveFlin com Jellyfin (versão inicial)

Esta branch adiciona **TV ao vivo M3U** ao backend compatível com Jellyfin do repositório `nelton10/drive-nelton`. O Google Drive, as bibliotecas existentes e o sistema de login continuam no projeto.

## Configurar IPTV usando Secrets da Cloudflare (recomendado)

Sem inserir a URL completa da playlist no navegador nem publicar senhas no GitHub:

1. Acesse **Cloudflare Dashboard → Workers & Pages → seu Worker → Settings → Variables and Secrets**.
2. Adicione estas variáveis ao ambiente **Production** (ou ao ambiente em uso):

   | Variável | Tipo | Valor |
   | --- | --- | --- |
   | `IPTV_SERVER_URL` | **Secret** | Endereço-base HTTP(S) do provedor, sem `get.php`, query, usuário ou senha |
   | `IPTV_USERNAME` | **Secret** | Nome de usuário do provedor |
   | `IPTV_PASSWORD` | **Secret** | Senha do provedor |
   | `IPTV_OUTPUT` | **Text** | `m3u8` (padrão) ou `ts` |

3. Confirme as alterações/publicação das variáveis. Secrets precisam estar disponíveis para o Worker em execução.
4. Abra `https://SEU-WORKER.workers.dev/iptv` como administrador.
5. Clique em **Atualizar IPTV pela Cloudflare**. O Worker consulta `get.php` usando os Secrets e importa até 1.500 entradas M3U para o banco D1.
6. Para atualizar novamente, use o mesmo botão. Se houver erro no download ou armazenamento, a lista anterior permanece disponível.

A URL de obtenção da playlist não aparece no painel nem é salva na tabela `IptvSources`. **Aviso de segurança:** as URLs individuais de reprodução entregues pelo provedor ainda são armazenadas em `IptvChannels` e podem conter credenciais. O player atual as acessa por redirecionamento, o que pode expô-las ao dispositivo; esta alteração **não implementa proxy de streaming privado**. Não compartilhe o acesso ao servidor. Para garantir sigilo dessas URLs é necessário um proxy autenticado, com tratamento específico para HLS e segmentos.

**Não inclua as credenciais no `wrangler.toml`, no `.dev.vars.example` nem em commits.** Usar Secrets na Cloudflare evita publicá-las no código. As variáveis IPTV são deliberadamente lidas diretamente do ambiente do Worker, não do KV de configuração do Google Drive.

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
