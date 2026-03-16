import React from "react";
import { motion } from "framer-motion";
import {
  X,
  BookOpen,
  Clock3,
  PencilLine,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

const timeOptions = [
  { label: "今", active: true },
  { label: "5分前", active: false },
  { label: "30分前", active: false },
  { label: "カスタム", active: false },
];

function BackgroundPreview() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-b from-violet-50 via-slate-50 to-slate-100">
      <div className="px-4 pb-4 pt-4 opacity-60 blur-[1px]">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">自分育成ゲーム</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">ホーム</div>
            <div className="mt-1 text-sm text-slate-500">今日の成長とクエスト</div>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200" />
        </div>

        <div className="rounded-3xl bg-slate-900 p-5 text-white shadow-xl">
          <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">User Level</div>
          <div className="mt-2 text-4xl font-bold tracking-tight">Lv.4</div>
          <div className="mt-1 text-sm text-white/70">次のレベルまであと 40XP</div>
          <div className="mt-4 h-2 rounded-full bg-white/10" />
        </div>

        <div className="mt-5 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-2xl bg-slate-100" />
                <div className="flex-1">
                  <div className="mb-2 h-4 w-36 rounded bg-slate-200" />
                  <div className="mb-3 h-3 w-44 rounded bg-slate-100" />
                  <div className="flex gap-2">
                    <div className="h-6 w-16 rounded-full bg-violet-100" />
                    <div className="h-6 w-14 rounded-full bg-slate-100" />
                  </div>
                </div>
                <div className="h-10 w-20 rounded-2xl bg-violet-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimeOption({ label, active }: { label: string; active: boolean }) {
  return (
    <button
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-violet-600 text-white shadow-sm"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

export default function SelfGrowthGameQuestCompleteModal() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100">
      <BackgroundPreview />

      <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]" />

      <div className="relative z-10 flex min-h-screen items-end justify-center p-4 sm:items-center">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <Card className="overflow-hidden border-0 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">クエストクリア</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">達成内容を記録</div>
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-2xl text-slate-500 hover:bg-slate-200">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <CardContent className="space-y-5 p-5">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-base font-semibold text-slate-900">読書する</div>
                      <Badge variant="secondary" className="rounded-full">+5XP</Badge>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">技術書を10分読む</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge className="rounded-full bg-violet-100 text-violet-700 hover:bg-violet-100">読書</Badge>
                      <Badge variant="outline" className="rounded-full">定常</Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Clock3 className="h-4 w-4 text-slate-500" />
                  実行日時
                </div>
                <div className="flex flex-wrap gap-2">
                  {timeOptions.map((option) => (
                    <TimeOption key={option.label} label={option.label} active={option.active} />
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <PencilLine className="h-4 w-4 text-slate-500" />
                  メモ（任意）
                </div>
                <Textarea
                  placeholder="例: 第3章を読んだ / 気づいたことをメモする"
                  className="min-h-[112px] rounded-2xl border-slate-200 bg-slate-50 text-sm"
                  defaultValue="第3章を読んだ"
                />
              </div>

              <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-violet-900">クリア後の処理</div>
                    <div className="mt-1 text-sm leading-6 text-violet-700">
                      ユーザーXPが加算され、必要に応じてスキルXPも反映されます。リリィのコメントも表示されます。
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <Button variant="outline" className="h-12 rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                  キャンセル
                </Button>
                <Button className="h-12 rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200 hover:bg-violet-700">
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  クリアする
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
