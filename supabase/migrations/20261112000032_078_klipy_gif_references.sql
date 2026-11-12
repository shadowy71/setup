-- Add KLIPY GIF references without modifying existing rows, RLS or grants.
-- Deploy only with explicit production approval after testing the client and CDN.
-- Retain the legacy GIPHY expression and also match its intended literal-dot
-- host pattern, which the historical expression double-escaped.

alter table public.posts
  drop constraint posts_gif_provider,
  drop constraint posts_gif_url_host,
  add constraint posts_gif_provider check (
    gif is null or (gif->>'provider') in ('giphy', 'klipy')
  ),
  add constraint posts_gif_url_host check (
    gif is null or case gif->>'provider'
      when 'giphy' then ((gif->>'url') ~ '^https://(media[0-9]?\\.)?giphy\\.com/'
                         or (gif->>'url') ~ '^https://(media[0-9]?[.])?giphy[.]com/')
      when 'klipy' then coalesce((gif->>'url') ~ '^https://static[12]?[.]klipy[.]com/', false)
      else false
    end
  );

alter table public.comments
  drop constraint comments_gif_provider,
  drop constraint comments_gif_url_host,
  add constraint comments_gif_provider check (
    gif is null or (gif->>'provider') in ('giphy', 'klipy')
  ),
  add constraint comments_gif_url_host check (
    gif is null or case gif->>'provider'
      when 'giphy' then ((gif->>'url') ~ '^https://(media[0-9]?\\.)?giphy\\.com/'
                         or (gif->>'url') ~ '^https://(media[0-9]?[.])?giphy[.]com/')
      when 'klipy' then coalesce((gif->>'url') ~ '^https://static[12]?[.]klipy[.]com/', false)
      else false
    end
  );

alter table public.messages
  drop constraint messages_gif_provider,
  drop constraint messages_gif_url_host,
  add constraint messages_gif_provider check (
    gif is null or (gif->>'provider') in ('giphy', 'klipy')
  ),
  add constraint messages_gif_url_host check (
    gif is null or case gif->>'provider'
      when 'giphy' then ((gif->>'url') ~ '^https://(media[0-9]?\\.)?giphy\\.com/'
                         or (gif->>'url') ~ '^https://(media[0-9]?[.])?giphy[.]com/')
      when 'klipy' then coalesce((gif->>'url') ~ '^https://static[12]?[.]klipy[.]com/', false)
      else false
    end
  );

alter table public.random_messages
  drop constraint random_messages_gif_provider,
  drop constraint random_messages_gif_url_host,
  add constraint random_messages_gif_provider check (
    gif is null or (gif->>'provider') in ('giphy', 'klipy')
  ),
  add constraint random_messages_gif_url_host check (
    gif is null or case gif->>'provider'
      when 'giphy' then ((gif->>'url') ~ '^https://(media[0-9]?\\.)?giphy\\.com/'
                         or (gif->>'url') ~ '^https://(media[0-9]?[.])?giphy[.]com/')
      when 'klipy' then coalesce((gif->>'url') ~ '^https://static[12]?[.]klipy[.]com/', false)
      else false
    end
  );

-- Preserve the deployed function body and privileges, replacing only its
-- provider guard. Fail atomically if its body differs from the audited version.
do $migration$
declare
  definition text;
  old_guard constant text := $$coalesce(p_gif->>'provider', '') <> 'giphy'$$;
  new_guard constant text := $$coalesce(p_gif->>'provider', '') not in ('giphy', 'klipy')$$;
begin
  select pg_get_functiondef('public.send_random_message(uuid,text,jsonb)'::regprocedure)
    into definition;
  if (length(definition) - length(replace(definition, old_guard, ''))) / length(old_guard) <> 1 then
    raise exception 'send_random_message provider guard differs from audited definition';
  end if;
  execute replace(definition, old_guard, new_guard);
end
$migration$;
