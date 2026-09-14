# Contract audit: the shipped settings UI against BUILD-CONTRACT.md

Audited September 13, 2026 for 1.3.1 (first pull request), against the 40 rules of `BUILD-CONTRACT.md` (exported from Plugin Settings Standard, Build contract tab) read with `BUILD-CONTRACT-DEFINITIONS.md`. Lines cite the tree as it stands after this pull request; a rule this pull request fixed says so and names what it was before. Host facts (what the Homebridge UI posts into the iframe, how it sizes and scrolls it, what its stylesheet paints) come from homebridge-config-ui-x 5.29.0's published bundle.

Status words: **implemented**, **implemented differently** (with how), **not implemented**.

## Shell

- **S1** implemented. The page draws no chrome and sets no page background: the root is one `div` (`homebridge-ui/public/index.html:10`); the stylesheet paints no `body` or root background (`homebridge-ui/public/index.css:9`); the host sizes the iframe to the page's own height and scrolls its modal body (5.29.0: `setiFrameHeight` from the page's `scrollHeight` message, `.modal-body{overflow-y:auto}`).
- **S2** implemented. `.notify-switch-ui { padding: 0 16px 1rem; overflow-wrap: anywhere }` with `width: 100%`, `max-width: 100%` (`homebridge-ui/public/index.css:9-15`); the grids are gap-based with no negative margins (`index.css:95-104`); the layout test asserts nothing wider than the viewport at 900, 599, 400 and 360px (`test/harness/ui-layout.test.mjs:266-270`).
- **S0** implemented differently. The banner is the first element at full width, 4:1, 6px radius, 16px top margin, served from the plugin folder (`homebridge-ui/src/main.ts:103`, `index.css:151-160`), with the alt text of the definitions since this pull request (`homebridge-ui/src/copy.ts:22-25`; it read "Notify Switch, Homebridge …" before). The artwork itself (`assets/notify-switch-banner.png`, 2560 × 640) still reads "SMS, email, or Telegram", not "SMS, email, Telegram, or ntfy": no source SVG or generator exists in the repository, so it was not redrawn here (see the report). The second half of 1.3.1 replaced the artwork with a redrawn banner that names ntfy, so S0 is implemented from 1.3.1.
- **S3** implemented. Page-level children in order: banner, [upgrade notice, M4, only while it applies], draft banner, two intro paragraphs, the four sections, the summary box, the closing paragraph, the footer (`main.ts:103-140`); the summary box is in the flow, not sticky, since this pull request (see F4).
- **S4** implemented. Paragraph one and paragraph two, ending "Save, restart Homebridge, and add the switch to a HomeKit automation." (`copy.ts:27-31`).
- **S5** implemented. The 20px mark in `currentColor`, inlined from `assets/notify-switch-mark.svg` (`homebridge-ui/src/mark.ts:1`, `homebridge-ui/src/footer.ts:20,33`), "Notify Switch v{version} · Made by Alex Rodriguez · alex-rodriguez.com · Report an issue" (`copy.ts:69-76`), the version from the installed package.json through `/version` (`footer.ts:43`, `src/ui/server.ts:21`), secondary text over a 1px top rule, wrapping between items (`index.css:1126-1135`), last element of the page (`main.ts:140`).

## Rhythm

- **R1** implemented. Providers, Recipient Groups, Switches, Settings, in dependency order, then the closing paragraph (`main.ts:28-33,120-123,138`).
- **R2** implemented. `h2.h5` (20px) at weight 300 with a 1px rule under it, 24px above each section (`main.ts:123`, `index.css:137-146`); one intro sentence (`homebridge-ui/src/sections/providers.ts:938`, `groups.ts:106`, `switches.ts:582`); the cards; exactly one 38px primary Add button (`homebridge-ui/src/dom.ts:222-239`, `providers.ts:941`, `groups.ts:111`, `switches.ts:596`).
- **R3** implemented. Add group and Add switch are outlined, disabled, `title` and the hint "Add a provider first." beside them while no provider exists (`dom.ts:231-239`, `copy.ts:56-60`); never hidden.
- **R4** implemented differently. With nothing configured the first section shows one Get started card holding the chooser tiles inline with no Cancel (`providers.ts:922-930,932-936`). The definitions' prompt is one line, "Get started. Choose how you want to begin, you can add more later." (weight 600); the shipped card has a header "Get started" and the body line "Choose how you want to send messages. You can add more providers later." (`copy.ts:56-60`, SPEC section 11.3).
- **R5** implemented. Settings renders its fields directly on the page in `.ns-grid` rows (`homebridge-ui/src/sections/settings.ts:190-268`), with its own Advanced disclosure holding the backups, Restore and Reset (`settings.ts:94-187`).

## Card

- **C1** implemented differently. Left: the name, bold at weight 700 since this pull request (600 before; `providers.ts:779`, `groups.ts:23`, `switches.ts:501`, `index.css:253-255`), live as typed, "New {noun}" while empty (`providers.ts:26-28`, `groups.ts:11-13`, `switches.ts:29`), then the type badge and the status badges (`homebridge-ui/src/card.ts:50-61`). Right: the help toggle. "Make default for {channel}" is a text button in the header's **right** cluster before the help toggle (`providers.ts:137-139`), as the definitions (item 4) render it, not in the left cluster as C1 reads.
- **C2** implemented. 12-column grid with an 8px column gap (`index.css:95-119`), 16px under each field (Bootstrap `mb-3`, `dom.ts:98`), two short fields share a row (for example `providers.ts` Email From address 7 and name 5; Cooldown and Failure Mode 6 and 6), every cell full width below 600px (`index.css:122-126`).
- **C3** implemented. Advanced is the last thing in the body, holds the read-only ID with its Edit link (`card.ts:77-102`) and the rarely used fields, collapsed by default and opened when something in it is set (`providers.ts:158-172`, `switches.ts` Advanced disclosure).
- **C4** implemented. Grey strip on `--bs-card-cap-bg` (re-declared `#262626` in dark mode, `index.css:50-52`), 8px 16px (`index.css:321-323`); left the red "Remove {noun}" then "Duplicate {noun}" in link colour, right at most one outlined primary action; primary first in the markup, row reversed (`dom.ts:365-370`, `index.css:801-807`); the layout test asserts the primary on top when the footer wraps (`ui-layout.test.mjs:347-354`).
- **C5** implemented. Remove and Test send replace their own button with the question, a confirm button and a text Cancel; Escape cancels (`dom.ts:324-352`, `switches.ts:164-170,547-556`); Reset opens a dialog, the one exception the rule allows (`settings.ts:137-162`).
- **C6** implemented. The result bar sits between the body and the footer with a Dismiss link (`dom.ts:278-288`, `index.css:310-317`); results never replace the page or open a dialog.

## Field

- **F1** implemented. Bold label (600) with a red asterisk when required (`dom.ts:95-104`, `index.css:444-447`), 38px control with a 6px radius at 16px (Bootstrap's `.form-control`, 11px side padding `index.css:204-211`), one line of help at 12.6px in the secondary colour with an optional question-named link (`dom.ts:91-93`, `index.css:58-67`).
- **F2** implemented. A field is marked once it has been touched, on focusout or on a select, checkbox or radio change, never on keystroke (`main.ts:144-153,412-420`); a newly added card holds its errors back until a field inside it is touched (`main.ts:357-377`).
- **F3** implemented. Invalid: `is-invalid` on the control (red border with Bootstrap's icon inside the control) and the message under it (`main.ts:669-673`); valid: the small green check inside the control (`index.css:423-442`, `main.ts:683-687`).
- **F4** implemented differently, by decision. "Fix these before saving:", one entry per problem reading "{Card name}: {message}" and moving focus to the field, the collapse past three entries to "N fields need attention" with Show all, SAVE disabled while the box shows (`main.ts:585-622`, `copy.ts:349-355`, `homebridge-ui/src/api.ts:40-46`). Since this pull request the box is **not sticky**: it sits in the page flow after Settings and before the closing paragraph with no shadow (`index.css:676-680`), because the iframe owns no scroll container (S1) and the sticky rule of 1.3.0 assumed one; the definitions' conflict note (item 10) says the same. It takes the warning colours of each theme (`index.css:343-353`, dark values `index.css:43-44`).
- **F5** implemented. Every secret is a password input with the attached Show toggle, `autocomplete="new-password"` (`dom.ts:154-167`); no Test connection answer echoes a credential (the harness asserts it, SPEC section 11.2, item 3); the draft in localStorage holds no credential since this pull request (`homebridge-ui/src/draft.ts:35-40,42-52`).
- **F6** implemented. Read-only and preset-locked controls use the secondary background with inherited text (`index.css:780-786`), with the Edit link on the label row for the ID (`card.ts:85-95`) and for the SMTP server fields (`providers.ts:372-373,393`).
- **F7** implemented differently. Rows of control plus REMOVE, an outlined "Add {thing}" under them, per-row validation below the row (`homebridge-ui/src/addressList.ts:46-118`). The empty line reads "None yet." on the switch's extra recipient lists (`copy.ts:203`) but "No phone numbers yet." (and so on per list) on the group card lists (`addressList.ts:53`).

## Theme

- **T1** implemented differently. Every colour the shell reads is a Bootstrap variable with a fallback (`index.css` throughout, for example `:56-65,343-353`), re-declared under the host's dark marker (`index.css:30-45,50-52`); those re-declarations supply values the host does not provide inside the iframe (5.29.0 posts body classes, never `data-bs-theme`, so Bootstrap's dark values are never in effect there). Fixed values remain for: the hover and press washes on outlined buttons and the footer action, `rgba(128,128,128,.08)` and `.2` (`index.css:334,397,405`); the checked mail-provider segment `#6c757d` (`index.css:415-419`); the modal backdrop `rgba(0,0,0,.55)` (`index.css:1056`); the white ground behind QR codes (`index.css:952`, needed for scanning); the dashed danger border of the SMS preview (`index.css:625`); white badge text. The warning border `#ffecb5` is hard-coded as the definitions (item 2) hard-code it.
- **T2** implemented. No font family and no type scale of the plugin's own: body 14.4px weight 300 from the host, labels 600 (`index.css:444-447`), help `.875em` = 12.6px, h2 `.h5` = 20px at weight 300 (`main.ts:123`, `index.css:141-146`), controls 16px (Bootstrap).
- **T3** implemented differently. Link colour for links and text buttons (`index.css:88-91,358-373`), danger only for Remove, Reset, asterisks and errors (the layout test asserts the red buttons, `ui-layout.test.mjs:362-368`), success for stored-as lines (`homebridge-ui/src/phone.ts:166-167`) and valid checks, the host primary for the one Add button per section. Beyond that, the primary colour also fills the draft banner's Restore (`main.ts:527`), the Test send "Send" confirm (`switches.ts:168`) and "Use the selected provider" (`providers.ts:84`), and rings the hovered chooser tile and the selected Telegram mode card (`index.css:887-892,985-988`).
- **T4** implemented. Below 600px every grid cell is full width (`index.css:122-126`), the mail-provider segments become a dropdown (`index.css:761-773`), card footers wrap with the primary action on top (`index.css:801-807`), QR codes give way to Open / Copy / Share (`index.css:1008-1027`, `card.ts:219-235`), every button is at least 44px on touch (`index.css:1029-1050`).
- **T5** implemented differently. Focus is never removed: the tile's `outline: none` is paired with a visible ring (`index.css:887-892`). Summary-box entries move focus to the field they name (`main.ts:445-459`). A **newly added** card does not focus its Name field: Add group, Add switch and a chooser tile create the card without moving focus (`providers.ts:880-885`, `groups.ts:111-117`, `switches.ts:596-601`); only Duplicate does (`groups.ts:95`, `switches.ts:570`).

## Copy

- **W1** implemented differently. Second person, present tense, no exclamation marks, no emoji (`copy.ts`). Help is one sentence for most fields, two for some (for example `copy.ts:95,129-130`); SPEC section 11.3 allows two at most.
- **W2** implemented. Help introduces examples with "For example:" (`copy.ts:53,110,113,116`), placeholders use "e.g." (the layout test asserts it, `ui-layout.test.mjs:447-451`), select options carry their example in parentheses ("12-hour (5:15 PM)", `copy.ts:264-273`).
- **W3** implemented. "Where do I find this?", "How do I register?", "Why not the Auth Token?", "Where do I create one?" (`copy.ts:14,96,100,115`); no "click here" or "docs".
- **W4** implemented differently. Format messages say what a good value looks like and where to get it (`copy.ts:317-346`). Empty required fields read "{Label} is required." (`homebridge-ui/src/validate.ts:80,159,179,185,188`), also for values that are not self-evident (Account SID, Host, Username, Password).
- **W5** implemented. Sentence case in the source, verb plus noun ("Add provider", "Test connection", "Download backup"); the stylesheet renders the small buttons and the Add buttons uppercase (`index.css:168-182`).

## Machinery

- **M1** implemented differently, within what the host allows. The draft is written to localStorage on every change once the user has changed something (`main.ts:490-511`, `draft.ts:42-52`), so closing with unsaved changes leaves one; reopening shows "You have unsaved changes from earlier. Restore them?" with RESTORE and DISCARD directly under the plugin banner, above the intro (`main.ts:113-117,514-536`, `copy.ts:379-383`). The host sends the page nothing at Close (nor at Save), so the draft cannot be written at the moment of closing; it is written as the user works. Since this pull request it holds structure only, and Restore takes the credentials back from the saved configuration (`homebridge-ui/src/model.ts:689-707`).
- **M2** implemented. Settings > Advanced: the note that the full backup contains credentials, Download backup, Download backup without credentials, Restore from backup (`settings.ts:164-186`, `copy.ts:446-461`).
- **M3** implemented differently. A red text button in Settings > Advanced opens a dialog with the three consequences, Download backup first, "Type RESET to confirm." and a red Confirm disabled until then (`settings.ts:137-162`, `copy.ts:462-472`). The button reads "Reset plugin to fresh install", not "Reset to fresh install".
- **M4** implemented differently. A stored configuration the editor cannot represent shows a notice at the top of the page (`main.ts:107-110`, `copy.ts:237-243`), disables everything except the backups and Reset (`main.ts:190-201`), and nothing is written back (`main.ts:490-494`). The notice is a **warning** box (`alert-warning`, the warning colours of F4), not the red notice M4 names.
- **M5** implemented. One Show help / Hide help toggle per card, collapsing field help only; counters, status lines and validation messages stay (`card.ts:29-43`, `index.css:467-473`).
- **M6** implemented. Everything is reachable from the field that needs it: README links on the help lines, Look up numbers, Open BotFather with its QR code, Find people and groups, the app-password links (`copy.ts`, `providers.ts`); no trip to config.json and no separate app.

## Fixed in this pull request

F4 (in flow, no shadow, focus without scrolling, warning colours), S0 (alt text only), C1 (title weight 700), the disabled-button rule and the chooser tile alignment under T4 and R4, and the draft contents under F5 and M1.

## Not fixed in this pull request (for the second half, or a decision)

- **S0**: the banner artwork still reads "SMS, email, or Telegram"; new artwork is needed (no source or generator in the repository). Done in the second half: the redrawn banner names ntfy.
- **R4**: the Get started copy differs from the definitions' one-line prompt.
- **C1**: "Make default for {channel}" sits in the right cluster, where the definitions put it; the contract text says left.
- **F7**: group card lists read "No {things} yet." instead of "None yet.".
- **T1**: the fixed hover and press washes, the checked segment fill, the modal backdrop, the QR ground and the SMS preview border.
- **T3**: the primary colour on Restore, the Send confirm, "Use the selected provider", the tile hover ring and the Telegram mode card ring.
- **T5**: a newly added card (Add group, Add switch, a chooser tile) does not focus its Name field.
- **W1**: two-sentence help on some fields.
- **W4**: "{Label} is required." on empty required fields whose value is not self-evident.
- **M3**: the Reset button's label.
- **M4**: the upgrade notice is a warning box, not red.
