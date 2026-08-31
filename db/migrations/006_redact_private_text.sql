-- Redact contact/document patterns that can occur inside otherwise allowed free text.
UPDATE bm_activity SET activity = regexp_replace(activity, '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', '[dado pessoal omitido]', 'gi') WHERE activity ~* '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}';
UPDATE bm_activity SET functionality = regexp_replace(functionality, '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', '[dado pessoal omitido]', 'gi') WHERE functionality ~* '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}';
UPDATE bm_activity SET activity = regexp_replace(activity, '[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}', '[dado pessoal omitido]', 'g') WHERE activity ~ '[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}';
UPDATE bm_activity SET functionality = regexp_replace(functionality, '[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}', '[dado pessoal omitido]', 'g') WHERE functionality ~ '[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}';
