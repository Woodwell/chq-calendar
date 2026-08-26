# infrastructure/sandbox-classes
#
# A standalone copy of the classes pipeline for validating it in your own AWS
# account, before proposing ../classes-ingest.tf upstream.
#
# Separate root, separate state, separate bucket. The parent configuration
# describes the whole of chqcal.org — buckets, CloudFront, DynamoDB, several
# Lambdas — so `terraform apply` there in a fresh account builds the entire
# site to test one function. This creates only what the pipeline needs.
#
# What it deliberately leaves out: CloudFront, a public-read bucket policy,
# DNS. Validating the pipeline means "does it run on schedule and write a
# correct catalog to S3" — how that file reaches a browser is a separate
# question, already answered elsewhere by a proxy.

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Matches the parent configuration. Not incidental: nodejs24.x, which
      # every Lambda in this repo uses, is unknown to provider 5.x and fails
      # validation there.
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "Region to create the sandbox in"
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Prefix for every resource, so a sandbox never collides with production names"
  type        = string
  default     = "chq-classes-sandbox"
}

variable "bucket_name" {
  description = "Globally unique bucket name for the published catalog"
  type        = string
}

variable "lambda_zip" {
  description = "Path to backend/lambda-function.zip, built by `npm run package:terraform`"
  type        = string
  default     = "../../backend/lambda-function.zip"
}

# Private. Nothing here is served to browsers, so there is no reason for this
# bucket to be readable by anyone but the function.
resource "aws_s3_bucket" "catalog" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "catalog" {
  bucket                  = aws_s3_bucket.catalog.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_role" "classes_ingest" {
  name = "${var.name_prefix}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.classes_ingest.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "scoped" {
  name = "${var.name_prefix}-scoped"
  role = aws_iam_role.classes_ingest.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject"],
        Resource = "${aws_s3_bucket.catalog.arn}/cache/calendar-cache/classes-*.json"
      },
      {
        # Without ListBucket, GetObject on a missing key answers 403 rather
        # than 404, and loadCatalog() cannot tell "no catalog yet" from a real
        # failure — so the first run, when the catalog cannot exist, aborts
        # and every run after it does too.
        Effect   = "Allow",
        Action   = ["s3:ListBucket"],
        Resource = aws_s3_bucket.catalog.arn,
        Condition = {
          StringLike = { "s3:prefix" = ["cache/calendar-cache/classes-*"] }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "classes_ingest" {
  name              = "/aws/lambda/${var.name_prefix}"
  retention_in_days = 14
}

resource "aws_lambda_function" "classes_ingest" {
  filename      = var.lambda_zip
  function_name = var.name_prefix
  role          = aws_iam_role.classes_ingest.arn
  handler       = "dist/classesIngestHandler.scheduledHandler"
  runtime       = "nodejs24.x"

  # See ../classes-ingest.tf: 258s for a full crawl, 605s for a season's
  # first run, which also has to learn every class's subjects.
  timeout     = 900
  memory_size = 512

  # Unreserved here, reserved in production — see ../classes-ingest.tf, which
  # caps this at 1 so the daily full crawl and the hourly spots pass cannot
  # overlap and publish a stale copy over each other's work.
  #
  # A new AWS account gets 10 concurrent executions and AWS will not let the
  # unreserved pool fall below 10, so reserving even 1 is rejected outright:
  #   InvalidParameterValueException: Specified ReservedConcurrentExecutions
  #   for function decreases account's UnreservedConcurrentExecution below its
  #   minimum value of [10]
  # Raising the quota is a support request, which is a lot of process to buy
  # a property this account does not need: both schedules below are DISABLED,
  # so the only way to run two of these at once is to invoke it twice by hand.
  #
  # Correctness does not rest on the cap in any case. The publisher's
  # conditional write is what makes an overlapping run impossible to lose data
  # to — it refuses the second write on a stale ETag. The cap only spares us
  # the refusal, and a sandbox can afford to lose a run.
  reserved_concurrent_executions = -1

  environment {
    variables = {
      CACHE_S3_BUCKET     = aws_s3_bucket.catalog.bucket
      CACHE_S3_KEY_PREFIX = "cache/calendar-cache"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.basic,
    aws_iam_role_policy.scoped,
    aws_cloudwatch_log_group.classes_ingest,
  ]

  source_code_hash = filebase64sha256(var.lambda_zip)
}

# Schedules are created disabled. A sandbox exists to be invoked by hand until
# it is trusted; nobody wants to discover it has been crawling a third party
# on a timer since the afternoon they applied it. Enable with:
#   aws events enable-rule --name <name>
resource "aws_cloudwatch_event_rule" "full" {
  name                = "${var.name_prefix}-full-daily"
  description         = "Daily full crawl (disabled until enabled by hand)"
  schedule_expression = "cron(0 9 * * ? *)"
  state               = "DISABLED"
}

resource "aws_cloudwatch_event_target" "full" {
  rule      = aws_cloudwatch_event_rule.full.name
  target_id = "full"
  arn       = aws_lambda_function.classes_ingest.arn
  input     = jsonencode({ mode = "full" })
}

resource "aws_lambda_permission" "full" {
  statement_id  = "AllowEventBridgeFull"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.classes_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.full.arn
}

resource "aws_cloudwatch_event_rule" "spots" {
  name                = "${var.name_prefix}-spots-hourly"
  description         = "Hourly spot-count refresh (disabled until enabled by hand)"
  schedule_expression = "rate(1 hour)"
  state               = "DISABLED"
}

resource "aws_cloudwatch_event_target" "spots" {
  rule      = aws_cloudwatch_event_rule.spots.name
  target_id = "spots"
  arn       = aws_lambda_function.classes_ingest.arn
  input     = jsonencode({ mode = "spots" })
}

resource "aws_lambda_permission" "spots" {
  statement_id  = "AllowEventBridgeSpots"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.classes_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.spots.arn
}

output "function_name" {
  value = aws_lambda_function.classes_ingest.function_name
}

output "catalog_bucket" {
  value = aws_s3_bucket.catalog.bucket
}

output "invoke_full" {
  description = "Run a full crawl by hand"
  value       = "aws lambda invoke --function-name ${aws_lambda_function.classes_ingest.function_name} --payload '{\"mode\":\"full\"}' --cli-binary-format raw-in-base64-out /dev/stdout"
}
