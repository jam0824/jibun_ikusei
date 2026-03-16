import React from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Sparkles,
  Trophy,
  Flame,
  Play,
  ArrowRight,
  ScrollText,
  BookOpen,
  Star,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

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
          {[1, 2].map((i) => (
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

function FloatingParticle({ className }: { className: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, y: 6 }}
      animate={{ opacity: [0, 1, 0.6, 0], scale: [0.5, 1, 1, 0.8], y: [6, -8, -16, -24] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
      className={className}
    >
      <Sparkles className="h-4 w-4 text-violet-300" />
    </motion.div>
  );
}

export default function SelfGrowthGameQuestClearEffect() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100">
      <BackgroundPreview />
      <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]" />

      <FloatingParticle className="absolute left-[18%] top-[14%] z-10" />
      <FloatingParticle className="absolute right-[16%] top-[18%] z-10" />
      <FloatingParticle className="absolute left-[24%] top-[24%] z-10" />
      <FloatingParticle className="absolute right-[28%] top-[28%] z-10" />

      <div className="relative z-20 flex min-h-screen items-end justify-center p-4 sm:items-center">
        <motion.div
          initial={{ opacity: 0, y: 22, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.26, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <Card className="overflow-hidden border-0 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="bg-gradient-to-b from-violet-50 to-white px-5 pb-4 pt-6">
              <div className="relative flex flex-col items-center text-center">
                <motion.div
                  initial={{ scale: 0.75, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.28, delay: 0.05 }}
                  className="relative flex h-20 w-20 items-center justify-center rounded-full bg-violet-600 text-white shadow-[0_16px_40px_rgba(139,92,246,0.35)]"
                >
                  <CheckCircle2 className="h-10 w-10" />
                  <div className="absolute inset-0 rounded-full ring-8 ring-violet-200/60" />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: 0.1 }}
                  className="mt-5"
                >
                  <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                    <Sparkles className="h-3.5 w-3.5" />
                    Quest Clear
                  </div>
                  <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900">読書する</div>
                  <div className="mt-1 text-sm text-slate-500">技術書を10分読む</div>
                </motion.div>
              </div>
            </div>

            <CardContent className="space-y-4 p-5">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.14 }}
                className="grid grid-cols-2 gap-3"
              >
                <div className="rounded-3xl border border-violet-100 bg-violet-50 p-4 text-center">
                  <div className="text-xs font-medium text-violet-700">獲得XP</div>
                  <div className="mt-2 text-3xl font-bold tracking-tight text-violet-900">+5</div>
                  <div className="mt-1 text-xs text-violet-600">User XP</div>
                </div>
                <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                  <div className="text-xs font-medium text-emerald-700">スキル</div>
                  <div className="mt-2 text-lg font-bold tracking-tight text-emerald-900">読書</div>
                  <div className="mt-1 text-xs text-emerald-600">+5 Skill XP</div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.18 }}
                className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  ユーザー進捗
                </div>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-bold tracking-tight text-slate-900">Lv.4</div>
                    <div className="mt-1 text-sm text-slate-500">次のレベルまであと35XP</div>
                  </div>
                  <Badge className="rounded-full bg-violet-100 text-violet-700 hover:bg-violet-100">190 / 225</Badge>
                </div>
                <Progress value={84} className="h-2" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.22 }}
                className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Flame className="h-4 w-4 text-rose-500" />
                  スキル進捗
                </div>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="inline-flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
                      <BookOpen className="h-4 w-4 text-slate-500" />
                      読書 Lv.2
                    </div>
                    <div className="mt-1 text-sm text-slate-500">次のレベルまであと15XP</div>
                  </div>
                  <Badge className="rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-100">50%</Badge>
                </div>
                <Progress value={50} className="h-2" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.26 }}
                className="rounded-3xl border border-violet-100 bg-violet-50 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                    <Star className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-violet-900">リリィ</div>
                      <Badge className="rounded-full bg-white text-violet-700 hover:bg-white">コメント</Badge>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-violet-700">
                      ナイスです。読書クエストをクリア。知識の積み上げが、しっかり経験値になっています。
                    </div>
                  </div>
                  <Button size="icon" variant="secondary" className="rounded-2xl bg-white hover:bg-violet-100">
                    <Play className="h-4 w-4 text-violet-700" />
                  </Button>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.3 }}
                className="grid grid-cols-2 gap-3 pt-1"
              >
                <Button variant="outline" className="h-12 rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                  <ScrollText className="mr-2 h-4 w-4" />
                  記録を見る
                </Button>
                <Button className="h-12 rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200 hover:bg-violet-700">
                  次のクエスト
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
