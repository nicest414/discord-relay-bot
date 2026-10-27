# discord-relay-bot

Discordサーバーに常駐し、外部クライアント（AIエージェントや自作ツール）が **HTTP API** でサーバーの会話履歴を取れるようにするBotです。GitHubのWebhookを受け取って、Issue・PR・レビューの通知をDiscordに流すこともできます。

- 読み取り専用がデフォルト（書き込みは `ENABLE_WRITE=true` のときだけ）
- APIはBearerキーで認証。`ALLOWED_GUILD_IDS` で公開するサーバーを限定できる
- Botが見られるのは、Botに付けたロールやチャンネル権限の範囲だけ（DMは読めません）
- 外部からの投稿でメンション（@everyone など）が飛ばないようにしています

## 1. Botを作る

1. https://discord.com/developers/applications →「New Application」で作成
2. 「Bot」→「Reset Token」でトークンを発行し、`.env` の `DISCORD_TOKEN` に入れる
3. 同じページの **Privileged Gateway Intents** で **Message Content Intent** をONにする（OFFだと本文が空になります）
4. 「OAuth2」→「URL Generator」で、Scopesは `bot`、Bot Permissionsは以下を選ぶ
   - 読むだけ：**View Channels**、**Read Message History**
   - GitHub通知や書き込みも使う：上記に加えて **Send Messages**、**Embed Links**
5. 生成されたURLを開いて、サーバーに招待する

特定のチャンネルだけを読ませたい場合は、各チャンネルの「権限」でBotのロールの「チャンネルを見る」を ✕ にしてください。

## 2. 起動

Node.js 20以上が必要です。

```bash
cp .env.example .env   # 値を埋める（API_KEY は `openssl rand -hex 32` などで生成）
npm install
npm run dev            # 開発用（ファイル変更で自動再起動）
# 本番用
npm run build && npm start
```

Dockerで動かす場合：

```bash
docker build -t discord-relay-bot .
docker run --env-file .env -p 3000:3000 discord-relay-bot
```

### 外部に公開する（自宅PCで動かす場合）

GitHub Webhookや外部のAIから叩くには、公開URLが必要です。[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) を使うと、ポートを開けずに一時URLを発行できます。

```bash
cloudflared tunnel --url http://localhost:3000
```

## 3. API

`/health` と `/webhooks/github` 以外は、すべて `Authorization: Bearer <API_KEY>` ヘッダーが必要です。

| Method | Path | 内容 |
| --- | --- | --- |
| GET | `/health` | 死活確認 |
| GET | `/api/guilds` | Botが参加しているサーバー（許可リスト内のもの） |
| GET | `/api/guilds/:guildId/channels` | Botが見られるチャンネルの一覧 |
| GET | `/api/channels/:channelId/messages` | メッセージをJSONで取得（古い順） |
| GET | `/api/channels/:channelId/transcript` | 同じ内容をプレーンテキストで取得（LLMにそのまま渡せる形） |
| GET | `/api/channels/:channelId/threads` | チャンネル内のスレッド一覧（アクティブなもの＋アーカイブ済みの公開スレッド） |
| POST | `/api/channels/:channelId/messages` | `{"content": "..."}` を投稿（`ENABLE_WRITE=true` のときだけ） |
| POST | `/webhooks/github` | GitHub Webhookの受け口 |

`messages` と `transcript` のクエリパラメータ：`limit`（1〜100、デフォルト50）、`before` または `after`（メッセージID）。スレッドもチャンネルIDとして指定できます。

```bash
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/api/guilds"
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/api/channels/123456789012345678/transcript?limit=100"
```

## 4. GitHub通知

1. `.env` に `GITHUB_WEBHOOK_SECRET`（任意の文字列）と `GITHUB_NOTIFY_CHANNEL_ID`（通知先チャンネルのID）を設定する
2. GitHubのリポジトリ設定 →「Webhooks」→「Add webhook」
   - Payload URL：`https://<公開URL>/webhooks/github`
   - Content type：`application/json`
   - Secret：`GITHUB_WEBHOOK_SECRET` と同じ値
   - イベント：Issues、Pull requests、Issue comments、Pull request reviews

通知される内容：Issueの作成・クローズ・再オープン、PRの作成・Ready for review・マージ・クローズ、コメント、レビュー（承認・変更リクエストなど）。

## 開発

```bash
npm run typecheck && npm run lint && npm test
```
