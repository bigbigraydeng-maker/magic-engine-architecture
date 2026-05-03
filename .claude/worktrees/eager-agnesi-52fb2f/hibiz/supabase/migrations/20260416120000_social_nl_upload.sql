-- Allow natural-language + user-upload driven social posts
alter table public.social_posts drop constraint if exists social_posts_content_type_check;

alter table public.social_posts add constraint social_posts_content_type_check check (
  content_type in (
    'just_listed',
    'just_sold',
    'open_home',
    'market_update',
    'buying_tips',
    'nl_upload'
  )
);
