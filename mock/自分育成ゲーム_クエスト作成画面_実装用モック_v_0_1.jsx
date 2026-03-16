import React from "react";
import {
  Home,
  ListTodo,
  Plus,
  Sparkles,
  ScrollText,
  Bell,
  ChevronRight,
  BookOpen,
  Shield,
  Lock,
  Brain,
  CheckCircle2,
  Repeat,
  Flag,
  Clock3,
  Target,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const xpPresets = [3, 5, 10, 20, 40];
const categories = ["学習", "健康", "仕事", "生活", "対人", "創作"];

function BottomNav() {
  const itemBase = "flex flex-col items-center gap-1 text-[10px]";
  return (
    <div className="grid grid-cols-5 border-t border-slate-200 bg-white px-3 py-3">
      <div className={`${itemBase} text-slate-400`}>
        <Home className="h-4 w-4" />
        <span>ホーム</span>
      </div>
      <div className={`${itemBase} text-slate-400`}>
        <ListTodo className="h-4 w-4" />
        <span>クエスト</span>
      </div>
      <div className={`${itemBase} text-violet-600`}>
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

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {description ? <div className="mt-1 text-sm text-slate-500">{description}</div> : null}
    </div>
  );
}

function TypeSelector() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button className="rounded-2xl border border-violet-600 bg-violet-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
          <Repeat className="h-5 w-5" />
        </div>
        <div className="text-sm font-semibold text-violet-900">定常クエスト</div>
        <div className="mt-1 text-xs leading-5 text-violet-700">読書や運動のように、何度も繰り返すクエスト</div>
      </button>

      <button className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
          <Flag className="h-5 w-5" />
        </div>
        <div className="text-sm font-semibold text-slate-900">単発クエスト</div>
        <div className="mt-1 text-xs leading-5 text-slate-500">資料作成や手続きなど、1回で完了するクエスト</div>
      </button>
    </div>
  );
}

function XpSelector() {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {xpPresets.map((xp) => {
        const active = xp === 5;
        return (
          <button
            key={xp}
            className={`rounded-2xl px-3 py-3 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 ${
              active
                ? "border border-violet-600 bg-violet-50 text-violet-700"
                : "border border-slate-200 bg-white text-slate-700"
            }`}
          >
            {xp} XP
          </button>
        );
      })}
      <button className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5">
        その他
      </button>
    </div>
  );
}

function CategorySelector() {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((category, index) => {
        const active = index === 0;
        return (
          <button
            key={category}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              active
                ? "bg-violet-600 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {category}
          </button>
        );
      })}
    </div>
  );
}

function SkillModeSelector() {
  return (
    <div className="space-y-3">
      <button className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <Target className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">固定スキル</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">毎回同じスキルに経験値を加算します</div>
            </div>
          </div>
          <Badge variant="outline" className="rounded-full">未選択</Badge>
        </div>
      </button>

      <button className="w-full rounded-2xl border border-violet-600 bg-violet-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-violet-900">AI自動抽象化</div>
              <div className="mt-1 text-xs leading-5 text-violet-700">
                GPTが既存スキルへ寄せて抽象化します。初期設定ではこれを推奨します。
              </div>
            </div>
          </div>
          <Badge className="rounded-full bg-violet-600 text-white hover:bg-violet-600">推奨</Badge>
        </div>
      </button>

      <button className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">毎回確認する</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">クリア時に候補からスキルを選びます</div>
            </div>
          </div>
          <ChevronRight className="mt-1 h-4 w-4 text-slate-400" />
        </div>
      </button>
    </div>
  );
}

function AdvancedSettings() {
  return (
    <div className="space-y-3">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <Clock3 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">クールダウン</div>
              <div className="mt-1 text-xs text-slate-500">同じ定常クエストを連続で達成しすぎないようにします</div>
            </div>
          </div>
          <Badge variant="secondary" className="rounded-full">720分</Badge>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">おすすめ表示タイミング</div>
              <div className="mt-1 text-xs text-slate-500">ホームの「今日のクエスト」に出しやすくします</div>
            </div>
          </div>
          <Badge variant="secondary" className="rounded-full">夜</Badge>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">非AIモード</div>
              <div className="mt-1 text-xs text-slate-500">外部AIに送らず、固定スキルのみ使います</div>
            </div>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
            OFF
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SelfGrowthGameQuestCreateScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-violet-50 via-slate-50 to-slate-100">
      <div className="flex-1 overflow-auto px-4 pb-4 pt-4">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">自分育成ゲーム</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">クエスト追加</div>
            <div className="mt-1 text-sm text-slate-500">育てたい行動をクエストとして登録します</div>
          </div>
          <Button size="icon" className="rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200 hover:bg-violet-700">
            <Bell className="h-5 w-5" />
          </Button>
        </div>

        <section>
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-4 p-4">
              <div>
                <SectionHeader title="基本情報" />
                <div className="space-y-3">
                  <Input
                    defaultValue="読書する"
                    placeholder="クエスト名"
                    className="h-11 rounded-2xl border-slate-200 bg-slate-50"
                  />
                  <Textarea
                    defaultValue="技術書を10分読む"
                    placeholder="説明を入力"
                    className="min-h-[100px] rounded-2xl border-slate-200 bg-slate-50"
                  />
                </div>
              </div>

              <div>
                <SectionHeader title="種別" description="定常クエストか単発クエストかを選びます" />
                <TypeSelector />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-5">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="space-y-4 p-4">
              <div>
                <SectionHeader title="経験値" description="クエスト達成時に加算するユーザーXPです" />
                <XpSelector />
              </div>

              <div>
                <SectionHeader title="カテゴリ" description="一覧や集計に使う大分類です" />
                <CategorySelector />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-5">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-4">
              <SectionHeader title="スキル付与方法" description="クエストをどのスキルに紐づけるかを決めます" />
              <SkillModeSelector />
            </CardContent>
          </Card>
        </section>

        <section className="mt-5">
          <SectionHeader title="詳細設定" description="後からでも変更できます" />
          <AdvancedSettings />
        </section>

        <section className="mt-5 pb-6">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <Shield className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">このクエストの想定スキル</div>
                <div className="mt-1 text-sm text-slate-600">AI自動抽象化を使うと、「読書」スキルに寄せて登録される想定です。</div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-12 rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            下書き保存
          </Button>
          <Button className="h-12 rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200 hover:bg-violet-700">
            クエストを作成
          </Button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
