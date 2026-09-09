# Starter Templates (CSV)

Free downloadable CSV templates for bringing your existing records into Ranch
Manager Pro. They are plain spreadsheets: a header row plus one example row you
delete before importing. No formulas or macros.

## Where to get them

- **Templates page:** `/onboarding/templates` (also linked from the app's More
  menu).
- **Empty states:** the Livestock, Pastures, Hay & Feed, Equipment, Expenses,
  and Tasks pages each show a "⬇ Download starter templates" link under the
  "add first …" button when you have no records yet.
- Each template downloads at `/templates/<slug>.csv`. Downloads require being
  signed in; if you are not, you are redirected to the sign-in page
  (`/login?reason=auth`) and sent back after.

## The six templates

| Slug | Title | One row per | Required fields | Key accepted values |
| --- | --- | --- | --- | --- |
| `livestock` | Livestock | animal | `tag_number`, `species` | species=cattle\|horse\|goat\|sheep; sex=female\|male\|castrated; status=active\|pending\|sold\|deceased\|culled\|archived |
| `pastures` | Pastures / acreage | pasture | `name`, `size_acres` (>0) | status=grazing\|resting\|idle\|maintenance |
| `hay-feed` | Hay / feed inventory | hay stack or feed bin | `type`, `quantity`, `unit` | hay units=bales\|tons; feed units=lbs\|bags\|tons; category=grain\|supplement\|mineral\|hay-substitute\|other |
| `equipment` | Equipment | machine/asset | `name`, `category` | category=truck\|tractor\|trailer\|implement\|atv\|stationary\|other; status=in-service\|maintenance-due\|out-of-service; condition=excellent\|good\|fair\|poor; fuel=diesel\|gasoline\|gas\|electric\|other |
| `expenses` | Expenses | expense | `category`, `amount` (>0), `date`, `vendor` | category is one of the 12: hay_feed\|livestock\|fuel\|repairs_maintenance\|veterinary\|supplies\|labor\|utilities\|land_pasture\|insurance\|taxes_fees\|other; amount in whole dollars; date YYYY-MM-DD |
| `tasks` | Ranch tasks | task | `title` | status=to_do\|in_progress\|completed\|canceled; priority=low\|normal\|high\|urgent; category=livestock\|feed/hay\|pasture\|fencing/water\|equipment\|crops/farm\|paperwork\|general |

Every file includes, for each field: the name, whether it's required, an
example value, and a one-line legend explaining the accepted values. Optional
fields can be left blank — documented defaults apply (e.g. livestock status
blank = active; task status blank = to_do).

The expenses template reflects the current 12-category list (migration 0018
remapped the old `feed`/`vet_health`/`maintenance` values to
`hay_feed`/`veterinary`/`repairs_maintenance`; the template only issues the
new values).
