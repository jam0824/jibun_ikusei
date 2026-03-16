import React from "react";
import {
  Home,
  ListTodo,
  Plus,
  Sparkles,
  ScrollText,
  Search,
  Filter,
  BookOpen,
  Dumbbell,
  FileText,
  MessageSquare,
  ChevronRight,
  Clock3,
  Pin,
  Bell,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const tabs = ["今日", "すべて", "定常", "単発", "完了済み"];

const quests = [
  {
    icon: FileText,
    title: "企画資料を作る",
    detail: "導入2ページを作成",
    xp: 20,
    skill: "資料作成",
    type: "単発",
    state: "期限 3/20",
    actionLabel: "クリア",
    actionable: true,
    pinned: true,
  },
  {
    icon: BookOpen,
    title: "読書する",
    detail: "技術書を10分読む",
    xp: 5,
    skill: "読書",
    type: "定常",
    state: "本日 0/1",
    actionLabel: "クリア",
    actionable: true,
    pinned: false,
  },
  {
    icon: Dumbbell,
    title: "腕立て伏せをする",
    detail: "20回 × 2セット",
    xp: 8,
    skill: "運動",
    type: "定常",
    state: "次回可能 19:30",
    actionLabel: "待機中",
    actionable: false,
    pinned: false,
  },
  {
    icon: MessageSquare,
    title: "会議で1回発言する",
    detail: "進行中の案件で意見を1つ出す",
    xp: 10,
    skill: "発信",
    type: "単発",
    state: "期限なし",
    actionLabel: "詳細",
    actionable: true,
    pinned: false,
  },
  {
    icon: BookOpen,
    title: "英語学習をする",
    detail: "単語アプリを15分進める",
    xp: 5,
    skill: "英語",
    type: "定常",
    state: "本日 0/1",
    actionLabel: "クリア",
    actionable: true,
    pinned: false,
  },
];

function BottomNav() {
  const itemBase = "flex flex-col items-center gap-1 text-[10px]";
  return (
    <div className="grid grid-cols-5 border-t border-slate-200 bg-white px-3 py-3">
      <div className={`${itemBase} text-slate-400`}>
        <Home className="h-4 w-4" />
        <span>ホーム</span>
      </div>
      <div className={`${itemBase} text-violet-600`}>
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

function SummaryBar() {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="text-xs text-slate-500">今日の候補</div>
          <div className="mt-1 text-xl font-bold text-slate-900">5件</div>
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="text-xs text-slate-500">期限近い</div>
          <div className="mt-1 text-xl font-bold text-slate-900">1件</div>
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="text-xs text-slate-500">定常クエスト</div>
          <div className="mt-1 text-xl font-bold text-slate-900">3件</div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuestTabs() {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map((tab, index) => {
        const active = index === 0;
        return (
          <button
            key={tab}
            className={`rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition ${
              active
                ? "bg-violet-600 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}

function SearchBar() {
  return (
    <div className="flex gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="クエストを検索"
          className="h-11 rounded-2xl border-slate-200 bg-white pl-10 shadow-sm"
        />
      </div>
      <Button variant="outline" size="icon" className="h-11 w-11 rounded-2xl border-slate-200 bg-white shadow-sm">
        <Filter className="h-4 w-4 text-slate-600" />
      </Button>
    </div>
  );
}

function QuestCard({ quest }: { quest: (typeof quests)[number] }) {
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
              {quest.pinned ? (
                <Badge className="rounded-full bg-amber-100 text-amber-700 hover:bg-amber-100">
                  <Pin className="mr-1 h-3 w-3" />
                  優先
                </Badge>
              ) : null}
            </div>

            <div className="mt-1 text-xs text-slate-500">{quest.detail}</div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-violet-100 text-violet-700 hover:bg-violet-100">{quest.skill}</Badge>
              <Badge variant="outline" className="rounded-full">{quest.type}</Badge>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <Clock3 className="h-3 w-3" />
                {quest.state}
              </span>
            </div>
          </div>

          <Button
            className={`rounded-2xl px-4 ${
              quest.actionable
                ? quest.actionLabel === "詳細"
                  ? "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                  : "bg-violet-600 hover:bg-violet-700"
                : "bg-slate-100 text-slate-400 hover:bg-slate-100"
            }`}
          >
            {quest.actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SortBar() {
  return (
    <div className="flex items-center justify-between text-xs text-slate-500">
      <div>表示順: 優先 → 期限 → 更新</div>
      <button className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-violet-700 hover:bg-violet-50">
        並び替え
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function SelfGrowthGameQuestListScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-violet-50 via-slate-50 to-slate-100">
      <div className="flex-1 overflow-auto px-4 pb-4 pt-4">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">自分育成ゲーム</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">クエスト</div>
            <div className="mt-1 text-sm text-slate-500">今日やることと進行中のタスク</div>
          </div>
          <Button size="icon" className="rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200 hover:bg-violet-700">
            <Bell className="h-5 w-5" />
          </Button>
        </div>

        <SummaryBar />

        <section className="mt-5">
          <SearchBar />
        </section>

        <section className="mt-4">
          <QuestTabs />
        </section>

        <section className="mt-4">
          <SortBar />
        </section>

        <section className="mt-4 space-y-3 pb-6">
          {quests.map((quest) => (
            <QuestCard key={quest.title} quest={quest} />
          ))}
        </section>
      </div>

      <BottomNav />
    </div>
  );
}
