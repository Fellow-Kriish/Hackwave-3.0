# Demo sites

Two more apps for HackWave to test, each in three versions, served as static pages. They have no server: each saves its
records in the browser (`localStorage`), and their project files (`projects/shopsphere.json`,
`projects/harbor-pine.json`) tell the verifier where to read them. A result on these sites is checked against browser
storage: the app's real persistence, not what the page says, but weaker than a server's database.

```sh
pnpm sites                      # all six versions; or: node apps/demo-sites/serve.mjs shopsphere
pnpm engine try "Buy the Cloud Wireless Headphones" --target http://localhost:5182 --headed
pnpm engine try "Book the Harbor Suite" --target http://localhost:5193 --headed
```

| Site | v1 (original design) | v2 (redesign) | v3 (v2 with a bug) |
| --- | --- | --- | --- |
| ShopSphere store | http://localhost:5181 | http://localhost:5182 | http://localhost:5183 |
| Harbor & Pine hotel | http://localhost:5191 | http://localhost:5192 | http://localhost:5193 |

- **v1 → v2** is a real redesign of the same store or hotel: renamed buttons, a cart drawer and a checkout dialog (shop),
  a booking dialog (hotel), and new fields (city, postal code and a consent checkbox in the shop). HackWave heals it.
- **v3** looks exactly like v2, but its confirmation is shown while the order or reservation is not saved. HackWave
  reports RED: the page says "confirmed", the storage has nothing.

In the web app, type one of these addresses under "Any website": the matching project turns it into a verified test.
`pnpm sites` must be running.

## Where they came from, and what changed

They came from the team's `hackwave test.zip` (`hackwave test2` and `hackwave test3`). `hackwave test1` was not added:
its v3 is a static dashboard with hard-coded results and none of the app's features, so no goal can run on it.

Changes from the originals, all needed for a fair test:

1. **v1 rewritten as the same app.** The original v1s were different apps (ShopLite with 6 products in ₹; StayEasy with
   3 hotels in ₹) that saved nothing. They now keep their original layout and styles but sell ShopSphere's 12 products
   and Harbor & Pine's 6 rooms at the same prices as v2, and save orders and reservations in v2's format.
2. **Named product and room cards** (`aria-label` with the product or room name) in every version, so a button such as
   "Add to cart", repeated on every card, can be told apart, as a screen reader would.
3. **One storage key per app across versions** (`shopsphere-data`, `harbor-pine-data`) instead of a new key per
   version, as a real app keeps its storage across releases.
4. **Product names saved with each order line** in the shop (it saved only product ids).
5. **The v3 giveaways removed:** the confirmation no longer ends with "V3 test mode: this order was not saved", and the
   in-page QA panel no longer lists the bug as a failing check. The bug itself is unchanged.

The v2 and v3 scripts are otherwise as their authors wrote them, and lint skips them; v1 and `serve.mjs` are linted.
`packages/engine/src/demo-sites.test.ts` drives every version through a scripted purchase or booking with no model and
checks the verifier's result through the project files: v1 and v2 pass, v3 fails.
