# Medixus Minutes (MVP)

研究室・医局向けマルチテナント議事録 SaaS の MVP 実装。

## 実装状況

- `Phase 1` 完了
- Next.js 15 + TypeScript + Tailwind + shadcn/ui 初期化済み
- Supabase App Router 連携（server/client/middleware）実装済み
- 初期DBスキーマ + RLS + RPC + Storageポリシーを migration 化済み
- 認証導線の最小実装（login / signup / invite / callback）
- アプリ側ルーティング骨組み（orgs/meetings/glossary/corrections/settings）

## セットアップ

1. 依存関係をインストール

```bash
npm install
```

2. 環境変数を設定

```bash
cp .env.example .env.local
```

`.env.local` に以下を設定:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

3. Supabase にスキーマを適用

```bash
# Supabase CLI を使う場合
supabase db push
```

初期 migration:

- `supabase/migrations/20260408200500_initial_schema.sql`

## 開発

```bash
npm run dev
```

- App: [http://localhost:3000](http://localhost:3000)

## 品質確認

```bash
npm run lint
npm run build
```

## 補足

- ルートディレクトリ名に日本語が含まれるため、`create-next-app` の制約回避として `medixus-minutes/` 配下にプロジェクトを作成しています。
- API本体（transcribe / generate-minutes / corrections / comments / realtime）は各 Phase で順次実装するため、現状は `501 Not Implemented` のスタブです。
