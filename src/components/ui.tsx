import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
  size?: 'sm' | 'md' | 'icon'
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'border-violet-600 bg-violet-600 px-4 text-white shadow-lg shadow-violet-200 hover:bg-violet-700',
        variant === 'secondary' && 'border-slate-200 bg-slate-100 px-4 text-slate-700 hover:bg-slate-200',
        variant === 'ghost' && 'border-transparent bg-transparent px-3 text-slate-600 hover:bg-white/70',
        variant === 'outline' && 'border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50',
        variant === 'danger' && 'border-rose-200 bg-rose-50 px-4 text-rose-700 hover:bg-rose-100',
        size === 'sm' && 'h-9 rounded-xl px-3 text-xs',
        size === 'md' && 'h-11',
        size === 'icon' && 'h-11 w-11 p-0',
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-3xl border border-slate-200 bg-white shadow-sm', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

export function Badge({
  className,
  tone = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'soft' | 'outline' | 'success' | 'danger' | 'browsing' | 'warning'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold',
        tone === 'default' && 'bg-violet-100 text-violet-700',
        tone === 'soft' && 'bg-slate-100 text-slate-600',
        tone === 'outline' && 'border border-slate-200 bg-white text-slate-600',
        tone === 'success' && 'bg-emerald-100 text-emerald-700',
        tone === 'danger' && 'bg-rose-100 text-rose-700',
        tone === 'browsing' && 'bg-teal-100 text-teal-700',
        tone === 'warning' && 'bg-orange-100 text-orange-700',
        className,
      )}
      {...props}
    />
  )
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-2 rounded-full bg-slate-100', className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200',
        className,
      )}
      {...props}
    />
  )
}

export function Switch({
  checked,
  onCheckedChange,
  className,
  type,
  ...props
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'>) {
  return (
    <button
      type={type ?? 'button'}
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 items-center rounded-full transition',
        checked ? 'bg-violet-600' : 'bg-slate-200',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white transition',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}

export function Divider() {
  return <div className="h-px w-full bg-slate-100" />
}
