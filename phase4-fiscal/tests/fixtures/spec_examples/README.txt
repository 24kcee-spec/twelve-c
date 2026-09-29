ZIMRA Fiscal Device Gateway API v7.2, section 12 - published ILLUSTRATION-ONLY sample keys,
CSRs and certificates. Spec: "should NEVER BE USED IN REAL LIFE". These are the only
secret-type files allowed in this repository (see tests/test_repo_hygiene.py).

NOTE: the spec's sample CSR/certificate PEMs carry Subject CN=ZRB-eVFD-0000000042
(O=Zanzibar Revenue Board, C=TZ) although the spec TEXT says the CN is
ZIMRA-SN0001-0000000042. Use these files for key/signature vectors only, never as
proof of the ZIMRA CN format.
