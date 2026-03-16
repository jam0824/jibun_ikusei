import React from "react";
import {
  Home,
  ListTodo,
  Plus,
  Sparkles,
  ScrollText,
  Play,
  Trophy,
  BookOpen,
  Dumbbell,
  FileText,
  ChevronRight,
  Bell,
  Target,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const todayQuests = [
  {
    icon: BookOpen,
    title: "読書する",
    detail: "技術書を10分読む",
    xp: 5,
    skill: "読書",
    type: "定常",
    state: "クリア可能",
    actionable: true,
  },
  {
    icon: Dumbbell,
    title: "腕立て伏せをする",
    detail: "20回 × 2セット",
    xp: 8,
    skill: "運動",
    type: "定常",
    state: "次回可能 19:30",
    actionable: false,
  },
  {
    icon: FileText,
    title: "企画資料を作る",
    detail: "導入2ページを作成",
    xp: 20,
    skill: "資料作成",
    type: "単発",
    state: "期限 3/20",
    actionable: true,
  },
];

const recentSkills = [
  { name: "読書", level: 2, progress: 52, gain: "+10XP" },
  { name: "運動", level: 3, progress: 72, gain: "+8XP" },
  { name: "資料作成", level: 1, progress: 26, gain: "+20XP" },
];

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {action ? (
        <Button variant="ghost" size="sm" className="h-7 rounded-xl px-2 text-xs text-violet-700 hover:bg-violet-50">
          {action}
        </Button>
      ) : null}
    </div>
  );
}

function BottomNav() {
  const itemBase = "flex flex-col items-center gap-1 text-[10px]";
  return (
    <div className="grid grid-cols-5 border-t border-slate-200 bg-white px-3 py-3">
      <div className={`${itemBase} text-violet-600`}>
        <Home className="h-4 w-4" />
        <span>ホーム</span>
      </div>
      <div className={`${itemBase} text-slate-400`}>
        <ListTodo className="h-4 w-4" />
        <span>クエスト</span>
      </div>
      <div className={`${itemBase} text-slate-400`}>
        <Plus className="h-4 w-4" />
        <span>追加</span>
      </div>
      <div className={`${itemBase} text-slate-400`}>
        <Sparkles className="h-4 w-4" />
        <span>スキル</span>
      </div>
      <div className={`${itemBase} text-slate-400`}>
        <ScrollText className="h-4 w-4" />
        <span>記録</span>
      </div>
    </div>
  );
}

function LevelCard() {
  return (
    <Card className="overflow-hidden border-0 bg-slate-900 text-white shadow-xl shadow-slate-200">
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">User Level</div>
            <div className="mt-2 text-4xl font-bold tracking-tight">Lv.4</div>
            <div className="mt-1 text-sm text-white/70">次のレベルまであと 40XP</div>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-2 text-right">
            <div className="text-[10px] text-white/55">Total XP</div>
            <div className="text-xl font-semibold">185</div>
          </div>
        </div>
        <Progress value={84} className="h-2 bg-white/10" />
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-2xl bg-white/10 px-2 py-3">
            <div className="text-white/60">今日のXP</div>
            <div className="mt-1 text-lg font-semibold">+20</div>
          </div>
          <div className="rounded-2xl bg-white/10 px-2 py-3">
            <div className="text-white/60">連続日数</div>
            <div className="mt-1 text-lg font-semibold">7日</div>
          </div>
          <div className="rounded-2xl bg-white/10 px-2 py-3">
            <div className="text-white/60">クリア数</div>
            <div className="mt-1 text-lg font-semibold">3件</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LilyCard() {
  return (
    <Card className="border-violet-100 bg-white shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">リリィ</div>
              <Badge className="rounded-full bg-violet-50 text-violet-700 hover:bg-violet-50">ナビゲーター</Badge>
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-600">
              読書と運動が伸びています。あと1件でレベルアップです。今日は「資料作成」がおすすめです。
            </div>
          </div>
          <Button size="icon" variant="secondary" className="rounded-2xl bg-slate-100 hover:bg-slate-200">
            <Play className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SkillStrip() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {recentSkills.map((skill) => (
        <Card key={skill.name} className="min-w-[170px] border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">{skill.name}</div>
                <div className="text-xs text-slate-500">最近 {skill.gain}</div>
              </div>
              <Badge className="rounded-full bg-violet-100 text-violet-700 hover:bg-violet-100">Lv.{skill.level}</Badge>
            </div>
            <Progress value={skill.progress} className="h-2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function QuestCard({ quest }: { quest: (typeof todayQuests)[number] }) {
  const Icon = quest.icon;
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-semibold text-slate-900">{quest.title}</div>
              <Badge variant="secondary" className="rounded-full">+{quest.xp}XP</Badge>
            </div>
            <div className="mt-1 text-xs text-slate-500">{quest.detail}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-violet-100 text-violet-700 hover:bg-violet-100">{quest.skill}</Badge>
              <Badge variant="outline" className="rounded-full">{quest.type}</Badge>
              <span className="text-[11px] text-slate-500">{quest.state}</span>
            </div>
          </div>
          <Button
            className={`rounded-2xl px-4 ${
              quest.actionable
                ? "bg-violet-600 hover:bg-violet-700"
                : "bg-slate-100 text-slate-400 hover:bg-slate-100"
            }`}
          >
            {quest.actionable ? "クリア" : "待機中"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickActions() {
  const actions = [
    { icon: Plus, label: "クエスト追加", primary: true },
    { icon: Target, label: "スキルを見る", primary: false },
    { icon: CheckCircle2, label: "記録を見る", primary: false },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            className={`rounded-2xl px-3 py-4 text-left shadow-sm transition hover:-translate-y-0.5 ${
              action.primary
                ? "bg-violet-600 text-white"
                : "border border-slate-200 bg-white text-slate-700"
            }`}
          >
            <Icon className="mb-3 h-5 w-5" />
            <div className="text-sm font-semibold">{action.label}</div>
          </button>
        );
      })}
    </div>
  );
}

export default function SelfGrowthGameHomeScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-violet-50 via-slate-50 to-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/80 px-4 pb-4 pt-4 backdrop-blur">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">自分育成ゲーム</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">ホーム</div>
            <div className="mt-1 text-sm text-slate-500">今日の成長とクエスト</div>
          </div>
          <Button size="icon" className="rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200 hover:bg-violet-700">
            <Bell className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-4 py-4">
        <LevelCard />

        <section className="mt-5">
          <SectionHeader title="リリィ" />
          <LilyCard />
        </section>

        <section className="mt-5">
          <SectionHeader title="最近育っているスキル" action="一覧へ" />
          <SkillStrip />
        </section>

        <section className="mt-5">
          <SectionHeader title="今日のクエスト" action="すべて見る" />
          <div className="space-y-3">
            {todayQuests.map((quest) => (
              <QuestCard key={quest.title} quest={quest} />
            ))}
          </div>
        </section>

        <section className="mt-5">
          <SectionHeader title="クイックアクション" />
          <QuickActions />
        </section>

        <section className="mt-5 pb-6">
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <Trophy className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">今日の成長ハイライト</div>
                <div className="mt-1 text-sm text-slate-600">「発信」と「資料作成」に新しい進捗があります。</div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </div>
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
