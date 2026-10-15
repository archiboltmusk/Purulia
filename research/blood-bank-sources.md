# Blood bank data sources (for review, not published)

Last checked: 2026-10-15 from the project sandbox. Status column = what was actually reached. Nothing here is on the site yet.

| # | Source | Type | Reached? | What it holds | Licence / terms | Use on site |
|---|---|---|---|---|---|---|
| 1 | [eRaktKosh stock service](https://services.india.gov.in/service/detail/check-blood-bank-stock-availability-eraktkosh) | Official (MoHFW, run by CDAC) | Listing yes; stock page 503 | Live stock by blood bank | Not verified. No public API or licence found | Link only (in `blood.html`) |
| 2 | [eRaktKosh contact page](https://eraktkosh.mohfw.gov.in/BLDAHIMS/bloodbank/contact.cnt) | Official | Yes | CDAC Noida address, eraktkosh[at]cdac[dot]in, phone 9650816031. Blood Cell NHM: no phone or email | Page has no data-use notice (T&C linked, text not fetched) | Public contact is official; may show with link and date |
| 3 | [Blood Bank Directory, National Health Portal (data.gov.in)](https://www.data.gov.in/catalog/blood-bank-directory-national-health-portal) | Official open data, 2017 snapshot | No (403 from sandbox) | State, city, address, geo, contact, pin code | Not checked. data.gov.in datasets are usually under GODL-India; verify on the page | Best candidate for an all-India list once downloaded and dated 2017 |
| 4 | [NACO state-wise licensed blood banks](https://www.naco.gov.in/state-wise-list-registeredlicensed-blood-banks) | Official | Listed in search, not opened | State list, 2009-10 | Not checked | Stale; cite only with date |
| 5 | [CDSCO Blood Centre](https://cdsco.gov.in/opencms/opencms/en/BloodCentre/) | Official | Listed in search, not opened | Licensed centres by state, to Dec 2021, PDF | Not checked | Counts only |
| 6 | [MoHFW Blood Transfusion Services](https://dghs.mohfw.gov.in/bts.php) | Official | Listed in search, not opened | National total 4,263 licensed centres | Not checked | Count with link |
| 7 | [Delhi Drugs Control, blood centres](https://drugs.delhi.gov.in/drugs/blood-centre) | Official, state | Listed in search, not opened | Delhi list, dated 13.05.2025 | Not checked | Candidate for Delhi |
| 8 | [WB Health, blood bank page](https://www.wbhealth.gov.in/pages/blood_bank) | Official, state | Listed in search, not opened | WB blood banks with contact numbers | Not checked | Candidate for WB; verify numbers before use |
| 9 | [NBTC](https://naco.gov.in/national-blood-transfusion-council-nbtc-0) | Official | nbtc.gov.in did not resolve | Assessment reports, district data via a study | Not checked | Blocked |
| 10 | [Harvard Dataverse NBTC district dataset (via PMC10953889)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10953889/) | Peer-reviewed study data, 616 districts | Not opened | District indicators from NBTC reports | Not checked | Check the Dataverse licence first |
| 11 | [Dataful state counts](https://dataful.in/datasets/20099/) | Aggregator of official data | Listed, not opened | State counts, govt vs private, 30 Nov 2023 | Not checked | Summary only |

## Unofficial (leads only, never copied)

| Source | Notes |
|---|---|
| [raktkhoj.org](https://raktkhoj.org) | Self-described "demo project". Terms: no reuse licence, no API. Do not copy data. |
| [RaktRadar](https://github.com/unknownsteve7/RaktRadar), [RaktSetu](https://github.com/SayedZahur786/RaktSetu), [ekrakt](https://github.com/sreeprasad/ekrakt), [RarLink](https://github.com/saisiddi/rarelink) | Call eRaktKosh directly. Licences not verified. Do not copy code or data. |
| [Kaggle Blood Bank Details](https://www.kaggle.com/datasets/amalsp220/bloodbankdetails) | Donor list, not blood banks. Not used. |
| [Scribd Gujarat blood bank list](https://www.scribd.com/document/843979350/Gujarat-Data) | Unverified. Not used. |

## Open items

1. Download source 3 from a network that reaches data.gov.in. Check its licence on the page, then add the row count and the dated snapshot.
2. Ask eRaktKosh / NHM Blood Cell for written permission to publish the stock and bank list (blocks live stock and the map).
3. Open sources 4-8 and record licence and figures before any use.
4. Verify every phone number on its official page on the day it is published, and record the date.

## Verified 2026-10-15: CDSCO state-wise count (official PDF)

Source: [CDSCO, licensed Blood Centres, state/UT wise, up to Dec-2021](https://cdsco.gov.in/opencms/opencms/en/BloodCentre/) (released 2022-Jan-05). PDF, 1 page, downloaded and read.
Licence: not stated in the PDF; government document, check GODL terms before reuse.

| State | Govt | Other than govt | Total |
|---|---|---|---|
| West Bengal | 109 | 44 | 153 |
| All India | 1241 | 2541 | 3782 |

Note: All India total here (3782) differs from the MoHFW figure of 4,263 on [dghs.mohfw.gov.in/bts.php](https://dghs.mohfw.gov.in/bts.php). Different dates and definitions; cite each with its date. Names and addresses are not in this PDF, only counts.

## Status 2026-10-15 (coordinator decision: link out only)

- No donor register, no personal donor data on the site. Decided on the donor-register card: "Link out only".
- Delhi Drugs Control list and WB Health list: both returned 503 on 2026-10-15; not added to the site. Retry before use.
- Bank list not published until eRaktKosh or NBTC permission, or a verified licence, is in hand.
