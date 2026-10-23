-- "Só admins enviam mensagens" já existia em wa_groups.is_announce (sincronização
-- dos grupos). A coluna announce da migration anterior repetia isso: o valor vai
-- para is_announce e ela sai. O webhook passa a atualizar is_announce.
update public.wa_groups set is_announce = announce where announce is not null;
alter table public.wa_groups drop column if exists announce;
