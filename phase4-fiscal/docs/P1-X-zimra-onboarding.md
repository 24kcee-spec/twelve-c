# P1-X - Getting ZIMRA test-environment access (owner: Kudakwashe)

Nothing after P13 can happen without this. Start now; it runs in calendar time, not build time.

## What ZIMRA's public guidance says
- Virtual fiscal devices (server-to-server) are approved by the **regional FDMS support** office (PN 37/2026), by email.
- Support addresses (PN 37/2026, 16 Jun 2026):
  - SCOfdmssupport@zimra.co.zw
  - MCOfdmssupport@zimra.co.zw
  - LCOfdmssupport@zimra.co.zw
  - Region2fdmssupport@zimra.co.zw
  - Region3fdmssupport@zimra.co.zw
  Use the one for the region the **taxpayer** belongs to. Confirm which region applies before sending.
- The taxpayer must be VAT-registered to get a device; the taxpayer self-service portal is reached through TaRMS at mytaxselfservice.zimra.co.zw (branch registration, device ordering, fault reporting).

## Before you email - gather
- [ ] Taxpayer legal name, **TIN**, **VAT number** (use a real pilot business; a student project alone will not get one)
- [ ] Branch name and address (device is registered per trading location)
- [ ] Contact email and phone (at least one is mandatory in FDMS)
- [ ] Which region office applies
- [ ] Device model name and version you will declare (e.g. "Twelve C Fiscal Gateway", "v0.1")

## Draft email (edit the brackets)
Subject: Request for FDMS test-environment registration - virtual fiscal device (server-to-server) - [Business name], TIN [TIN]

Dear FDMS Support Team,

We are developing a software-based (virtual) fiscal device to interface directly with the FDMS Fiscal Device Gateway API (v7.2) for [Business name] (TIN [TIN], VAT [VAT no.], branch [branch/address]).

Please register us on the FDMS **test environment** and send:
1. the test API endpoints and Swagger access;
2. a test deviceID and activation key (or the process to obtain them);
3. the required device serial number and model name/version format;
4. confirmation of the process to submit sample invoices, credit notes and debit notes for approval.

Contact: [name, phone, email].

Regards,
[Name]

## After you receive credentials (do NOT put these in git)
Store deviceID, activation key and serial in your password manager. They go into P3's encrypted keystore, never into the repo (the .gitignore blocks key/cert files, but not plain text notes).

## Time expectation
Unknown; ZIMRA does not publish a turnaround. Follow up by phone or through the regional office after about 5 working days.
