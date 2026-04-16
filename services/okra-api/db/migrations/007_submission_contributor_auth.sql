alter table submissions
  add column if not exists contributor_cognito_sub text;

create index if not exists idx_submissions_contributor_cognito_sub_created
  on submissions(contributor_cognito_sub, created_at desc)
  where contributor_cognito_sub is not null;
