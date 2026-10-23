# How we score

The score measures one thing: a host's exposure to PHP2Shell (CVE-2026-109618 and
CVE-2026-109619). It is not a general PHP or web hygiene grade. The stage name is what a reader acts
on; the number is for those who want one. The code is `engine/assess.ts`; this page and that file
change together.

## The idea the score rests on

The version decides.

PHP2Shell lives in PHP 5.4.0 through 8.5.11, and the fixed releases are known: 8.5.12, 8.4.27,
8.3.36 and 8.2.35 (`engine/versions.ts`). So what a host advertises places it on the ladder. The
consent-gated validation is evidence that refines a hidden version; it never contradicts a known
one and never raises a score.

## Stages

| Stage | Technically | Score |
|---|---|---|
| No patch | 5.4.0 through 8.1.x: affected, and the branch is end-of-life | 15 |
| Exposed | 8.2.0 through 8.5.11, below the branch's fixed release | 35 |
| Hidden | PHP present, version not disclosed | 50 |
| Not affected | Older than 5.4.0 | 80 |
| Protected | The branch's fixed release or newer | 100 |

Unreachable (no web server answered) and Not PHP (nothing answered as PHP) carry no score: the
ring shows the word alone.

Why one number per stage: the reader acts on the stage, and a finer number would pretend to a
precision the two requests do not have. Hidden sits above Exposed because the host may be patched,
and below Not affected because it may not be.

## How a host is placed

1. Reachable: the front page answered an ordinary GET. Otherwise Unreachable.
2. Version: read from `X-Powered-By` or `Server` on the front page, or from the logo query's
   answer (PHP 5.4 and older with `expose_php` on). Classified by `classifyPhpVersion`: patched,
   vulnerable, no-patch, below-range.
3. PHP present, when no version was read: `X-Powered-By: PHP`, a `PHPSESSID` cookie, links or form
   actions to `.php` pages, or the logo image. Any one of them makes the stage Hidden. None of them,
   with the logo query answered, makes it Not PHP. The logo query alone proves nothing on a modern
   host: PHP 5.5 removed the easter eggs.
4. Validation, with consent and only when PHP is present. Reproduced on a host inside the range: a
   note, and a Hidden host becomes Exposed. Not reproduced: a note; the stage stands. Reproduced on
   a host the version places outside the range: a note that the two disagree, for a human to read.

## Foundations

Four facts under the cards, reported and never scored: the host answers an ordinary request, PHP
was identified, the version is disclosed, the branch still receives fixes.

## Notes the report can carry

- `eol-branch`: the branch is end-of-life (said on Not affected hosts: not a clean bill of health).
- `validation-reproduced`, with the signature observed.
- `validation-not-reproduced`: the memory limit may sit above 48 MB.
- `validation-disagrees`: the signature and the version do not agree.
