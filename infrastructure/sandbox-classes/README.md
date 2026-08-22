# Sandbox: classes pipeline

Validating the Special Studies pipeline in your own AWS account before
proposing `../classes-ingest.tf` upstream. Separate root, separate state,
separate bucket — the parent configuration describes the whole of chqcal.org,
so applying it in a fresh account would build the entire site to test one
function.

## Apply

```bash
# 1. Build the Lambda bundle the config uploads.
npm run package:terraform --workspace=chautauqua-backend

# 2. Apply. The bucket name has to be globally unique.
cd infrastructure/sandbox-classes
terraform init
terraform apply -var="bucket_name=chq-classes-sandbox-<something-unique>"
```

State is local: `terraform.tfstate` in this directory, gitignored. Lose it and
the resources are orphaned rather than destroyed, so keep it until you run
`terraform destroy`.

## Run it

Both schedules are created **disabled**. A sandbox should be invoked by hand
until it is trusted — nobody wants to find out it has been crawling someone
else's ticketing site on a timer since the afternoon they applied it.

```bash
terraform output -raw invoke_full     # prints the aws-cli command
```

The first run of a season takes about 605s: it crawls the catalog, then one
listing pass per subject to learn which classes belong to which. Later runs
skip that and take about 258s. A spots pass is about 23s.

Then check what it wrote:

```bash
aws s3 cp "s3://$(terraform output -raw catalog_bucket)/cache/calendar-cache/classes-2026.json" - \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["generatedAt"], len(d["classes"]), "classes", sum(len(c["sessions"]) for c in d["classes"]), "sessions")'
```

Run it a second time with nothing changed on the source site and it should
report `published: false` in the logs and leave the object alone.

Enable the schedules only once you are happy:

```bash
aws events enable-rule --name "$(terraform output -raw function_name)-full-daily"
aws events enable-rule --name "$(terraform output -raw function_name)-spots-hourly"
```

## Load on tickets.chq.org

Daily full crawl plus hourly spots is about **3,000 requests a day**: 513 for
a full pass (47 paginated listing POSTs plus a detail page for each of ~466
classes) and 105 for a spots pass. Hourly full crawls would be ~12,000/day to
observe a catalog that changes over days, which is why they are not on the
same clock.

## Tear down

```bash
terraform destroy -var="bucket_name=<the same name>"
```

The bucket must be empty first — `aws s3 rm s3://<bucket> --recursive`.
