"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { createCategory, createTopic, deleteCategory, deleteTopic, renameCategory, renameTopic } from "@/lib/admin/taxonomy";
import { activeCategories, categoryColor, topicsOf, type TaxonomyCategory, type TaxonomyTopic } from "@/lib/taxonomy";
import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/misc";
import { useApp } from "@/components/app/app-context";

/**
 * Categorias e subcategorias que o atendente escolhe ao finalizar. Categoria
 * com subcategoria não pode ser apagada; o que já foi usado é arquivado (some
 * das opções, o histórico e as métricas continuam com o nome).
 */
export function TaxonomySettings() {
  const { taxonomy } = useApp();
  const categories = activeCategories(taxonomy);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Categorias dos atendimentos</h2>
        <p className="text-[13px] text-muted-foreground">
          O que o atendente escolhe ao finalizar. Para apagar uma categoria, remova antes as subcategorias dela. O que já foi usado em
          atendimentos é arquivado: some das opções, mas o histórico e as métricas continuam com o nome.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {categories.map((c) => (
          <CategoryCard key={c.key} category={c} topics={topicsOf(taxonomy, c.key)} color={categoryColor(taxonomy, c.key)} />
        ))}
      </div>

      <NewCategory />
    </section>
  );
}

/** Roda a ação, avisa o resultado e devolve se deu certo. */
function useRun() {
  const [pending, start] = useTransition();
  const run = <T,>(action: () => Promise<ActionResult<T>>, success: (data: T) => string | null, after?: () => void) =>
    start(async () => {
      const res = await action();
      if (!res.ok) return void toast.error(res.error);
      const message = success(res.data);
      if (message) toast.success(message);
      after?.();
    });
  return { pending, run };
}

const removedMessage = (name: string) => (r: "deleted" | "archived") =>
  r === "archived" ? `“${name}” arquivada: já foi usada em atendimentos, então continua no histórico.` : `“${name}” apagada.`;

function CategoryCard({ category, topics, color }: { category: TaxonomyCategory; topics: TaxonomyTopic[]; color: string }) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const blocked = topics.length > 0;

  const remove = () => {
    if (blocked) {
      toast.error(`Remova as ${topics.length === 1 ? "subcategoria" : `${topics.length} subcategorias`} de “${category.label}” antes de apagar a categoria.`);
      return;
    }
    if (!confirming) return setConfirming(true);
    run(() => deleteCategory({ key: category.key }), removedMessage(category.label), () => setConfirming(false));
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
        {editing ? (
          <InlineName
            initial={category.label}
            pending={pending}
            onCancel={() => setEditing(false)}
            onSave={(label) => run(() => renameCategory({ key: category.key, label }), () => "Categoria renomeada.", () => setEditing(false))}
          />
        ) : (
          <>
            <span className="flex-1 truncate text-sm font-semibold">{category.label}</span>
            <Tip label="Renomear">
              <Button variant="ghost" size="icon-xs" onClick={() => setEditing(true)} aria-label={`Renomear ${category.label}`}>
                <Pencil />
              </Button>
            </Tip>
            <Tip label={blocked ? "Remova as subcategorias antes de apagar" : confirming ? "Clique de novo para confirmar" : "Apagar categoria"}>
              <Button
                variant={confirming ? "destructive" : "ghost"}
                size={confirming ? "sm" : "icon-xs"}
                onClick={remove}
                onBlur={() => setConfirming(false)}
                disabled={pending}
                aria-disabled={blocked}
                className={cn(blocked && "opacity-50")}
                aria-label={`Apagar ${category.label}`}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {confirming && "Apagar?"}
              </Button>
            </Tip>
          </>
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {topics.map((t) => (
          <TopicChip key={t.key} topic={t} />
        ))}
        {topics.length === 0 && <li className="text-xs text-muted-foreground">Sem subcategorias: ela não aparece ao finalizar.</li>}
      </ul>

      <AddInline
        placeholder="Nova subcategoria"
        onAdd={(label, reset) => run(() => createTopic({ category: category.key, label }), () => `Subcategoria “${label}” criada.`, reset)}
        pending={pending}
      />
    </div>
  );
}

function TopicChip({ topic }: { topic: TaxonomyTopic }) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <li className="w-full">
        <InlineName
          initial={topic.label}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSave={(label) => run(() => renameTopic({ key: topic.key, label }), () => "Subcategoria renomeada.", () => setEditing(false))}
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group/chip flex h-7 items-center gap-1 rounded-md border pl-2.5 pr-1 text-[13px]",
        confirming ? "border-destructive/50 bg-destructive-soft text-destructive" : "border-border bg-muted/40",
      )}
    >
      <button type="button" onClick={() => setEditing(true)} className="hover:underline" title="Renomear">
        {topic.label}
      </button>
      <button
        type="button"
        onClick={() => {
          if (!confirming) return setConfirming(true);
          run(() => deleteTopic({ key: topic.key }), removedMessage(topic.label), () => setConfirming(false));
        }}
        onBlur={() => setConfirming(false)}
        disabled={pending}
        className="flex items-center gap-1 rounded px-1 text-muted-foreground hover:text-destructive"
        aria-label={confirming ? `Confirmar remoção de ${topic.label}` : `Remover ${topic.label}`}
        title={confirming ? "Clique de novo para confirmar" : "Remover"}
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
        {confirming && <span className="text-[11px] font-medium">remover?</span>}
      </button>
    </li>
  );
}

function InlineName({ initial, pending, onSave, onCancel }: { initial: string; pending: boolean; onSave: (label: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const save = () => (value.trim() && value.trim() !== initial ? onSave(value.trim()) : onCancel());
  return (
    <form
      className="flex flex-1 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input
        autoFocus
        value={value}
        maxLength={40}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="h-7 text-[13px]"
        aria-label="Nome"
      />
      <Button type="submit" variant="ghost" size="icon-xs" disabled={pending} aria-label="Salvar">
        {pending ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" onClick={onCancel} aria-label="Cancelar">
        <X />
      </Button>
    </form>
  );
}

function AddInline({ placeholder, pending, onAdd }: { placeholder: string; pending: boolean; onAdd: (label: string, reset: () => void) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onAdd(value.trim(), () => setValue(""));
      }}
    >
      <Input value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="h-8 text-[13px]" aria-label={placeholder} />
      <Button type="submit" variant="outline" size="sm" disabled={pending || value.trim().length < 2}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar
      </Button>
    </form>
  );
}

function NewCategory() {
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const ready = name.trim().length >= 2 && topic.trim().length >= 2;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        run(
          () => createCategory({ label: name.trim(), firstTopic: topic.trim() }),
          () => `Categoria “${name.trim()}” criada.`,
          () => {
            setName("");
            setTopic("");
          },
        );
      }}
    >
      <span className="text-[13px] font-medium">Nova categoria</span>
      <p className="text-xs text-muted-foreground">Toda categoria começa com uma subcategoria (ao finalizar, a subcategoria é obrigatória). Depois dá para adicionar mais.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Nome da categoria (ex.: Treinamento)" className="h-9" aria-label="Nome da categoria" />
        <Input value={topic} maxLength={40} onChange={(e) => setTopic(e.target.value)} placeholder="Primeira subcategoria (ex.: Onboarding)" className="h-9" aria-label="Primeira subcategoria" />
        <Button type="submit" disabled={pending || !ready} className="shrink-0">
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} Criar categoria
        </Button>
      </div>
    </form>
  );
}
