/**
 * Cribl Search KQL catalog, generated from the live `GET /search/docs` bundle
 * (the same bundle that powers autocomplete in the Cribl Search editor).
 * Regenerate with scripts/gen-catalog.py if the deployment adds operators.
 */
export interface CatalogEntry {
  /** name as typed in a query */
  n: string;
  /** kind */
  k: 'operator' | 'function';
  /** category label */
  c: string;
  /** short description */
  d: string;
  /** one-line syntax */
  s: string;
  /** docs url */
  u: string;
}

export const KQL_CATALOG: CatalogEntry[] = [
{
"n": "abs",
"k": "function",
"c": "Mathematical Functions",
"d": "Calculates the absolute value of the input",
"s": "abs( X )",
"u": "https://docs.cribl.io/search/abs"
},
{
"n": "acos",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the angle whose cosine is the specified number",
"s": "acos( X )",
"u": "https://docs.cribl.io/search/acos"
},
{
"n": "ago",
"k": "function",
"c": "DateTime Functions",
"d": "Subtracts from UTC",
"s": "ago( Timespan )",
"u": "https://docs.cribl.io/search/ago"
},
{
"n": "asin",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the angle whose sine is the specified number",
"s": "asin( X )",
"u": "https://docs.cribl.io/search/asin"
},
{
"n": "atan",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the angle whose sine is the specified number",
"s": "atan( X )",
"u": "https://docs.cribl.io/search/atan"
},
{
"n": "atan2",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the angle whose tangent is the specified number",
"s": "atan2( Y, X )",
"u": "https://docs.cribl.io/search/atan2"
},
{
"n": "avg",
"k": "function",
"c": "Statistical Functions",
"d": "Calculate the average across a group",
"s": "avg( Expression )",
"u": "https://docs.cribl.io/search/avg"
},
{
"n": "avgif",
"k": "function",
"c": "Statistical Functions",
"d": "Calculate the average across a group of specific events",
"s": "avgif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/avgif"
},
{
"n": "bag_has_key",
"k": "function",
"c": "Dynamic Functions",
"d": "Check whether a property bag contains a given key",
"s": "bag_has_key( Bag, Key )",
"u": "https://docs.cribl.io/search/bag-has-key"
},
{
"n": "bag_keys",
"k": "function",
"c": "Dynamic Functions",
"d": "List all root keys of a property bag",
"s": "bag_keys( Bag )",
"u": "https://docs.cribl.io/search/bag-keys"
},
{
"n": "bag_merge",
"k": "function",
"c": "Dynamic Functions",
"d": "Merge multiple property bags, discarding duplicate keys",
"s": "bag_merge( Bag1, Bag2[, ...] )",
"u": "https://docs.cribl.io/search/bag-merge"
},
{
"n": "bag_pack",
"k": "function",
"c": "Dynamic Functions",
"d": "Creates a property bag from an alternating list of keys and values",
"s": "bag_pack( Key1, Value1, Key2, Value2, ... )",
"u": "https://docs.cribl.io/search/bag-pack"
},
{
"n": "bag_pack_columns",
"k": "function",
"c": "Dynamic Functions",
"d": "Create a property bag from a list of fields",
"s": "bag_pack( FieldName[, ...] )",
"u": "https://docs.cribl.io/search/bag-pack-columns"
},
{
"n": "bag_remove_keys",
"k": "function",
"c": "Dynamic Functions",
"d": "Removes keys and their values from a property bag",
"s": "bag_remove_keys( Bag, Keys )",
"u": "https://docs.cribl.io/search/bag-remove-keys"
},
{
"n": "bag_set_key",
"k": "function",
"c": "Dynamic Functions",
"d": "Add or overwrite a key-value pair in a property bag",
"s": "bag_set_key( Bag, Key, Value )",
"u": "https://docs.cribl.io/search/bag-set-key"
},
{
"n": "bag_zip",
"k": "function",
"c": "Dynamic Functions",
"d": "Create a property bag from two dynamic arrays",
"s": "bag_zip( KeysArray, ValuesArray )",
"u": "https://docs.cribl.io/search/bag-zip"
},
{
"n": "base64_decode_toarray",
"k": "function",
"c": "String Functions",
"d": "Decodes a base64 string to an array of single-character strings",
"s": "base64_decode_toarray( String )",
"u": "https://docs.cribl.io/search/base64-decode-toarray"
},
{
"n": "base64_decode_tostring",
"k": "function",
"c": "String Functions",
"d": "Decodes a base64 string to a UTF-8 string",
"s": "base64_decode_tostring( String )",
"u": "https://docs.cribl.io/search/base64-decode-tostring"
},
{
"n": "base64_encode_fromarray",
"k": "function",
"c": "String Functions",
"d": "Encodes a base64 string from a bytes array",
"s": "base64_encode_fromarray( BytesArray )",
"u": "https://docs.cribl.io/search/base64-encode-fromarray"
},
{
"n": "base64_encode_tostring",
"k": "function",
"c": "String Functions",
"d": "Encodes a string as base64 string",
"s": "base64_encode_tostring( String )",
"u": "https://docs.cribl.io/search/base64-encode-tostring"
},
{
"n": "beta_cdf",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the standard cumulative beta distribution function",
"s": "beta_cdf( X, Alpha, Beta )",
"u": "https://docs.cribl.io/search/beta-cdf"
},
{
"n": "beta_inv",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the inverse of the beta cumulative probability beta density function",
"s": "beta_inv( Probability, Alpha, Beta )",
"u": "https://docs.cribl.io/search/beta-inv"
},
{
"n": "beta_pdf",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the probability density beta function",
"s": "beta_pdf( X, Alpha, Beta )",
"u": "https://docs.cribl.io/search/beta-pdf"
},
{
"n": "bin",
"k": "function",
"c": "Conversion Functions",
"d": "Round events into bins",
"s": "bin( Value, RoundTo )",
"u": "https://docs.cribl.io/search/bin"
},
{
"n": "bin_auto",
"k": "function",
"c": "Conversion Functions",
"d": "Round events into bins",
"s": "bin_auto( Expression )",
"u": "https://docs.cribl.io/search/bin-auto"
},
{
"n": "binary_and",
"k": "function",
"c": "Binary Functions",
"d": "Get the bitwise and between two numbers",
"s": "binary_and( Number1, Number2 )",
"u": "https://docs.cribl.io/search/binary-and"
},
{
"n": "binary_not",
"k": "function",
"c": "Binary Functions",
"d": "Get the bitwise negation of a number",
"s": "binary_not( Number )",
"u": "https://docs.cribl.io/search/binary-not"
},
{
"n": "binary_or",
"k": "function",
"c": "Binary Functions",
"d": "Get bitwise or of two values",
"s": "binary_or( Number1, Number2 )",
"u": "https://docs.cribl.io/search/binary-or"
},
{
"n": "binary_shift_left",
"k": "function",
"c": "Binary Functions",
"d": "Get the binary shift left on a pair of numbers",
"s": "binary_shift_left( Number1, Number2 )",
"u": "https://docs.cribl.io/search/binary-shift-left"
},
{
"n": "binary_shift_right",
"k": "function",
"c": "Binary Functions",
"d": "Get the binary shift right on a pair of numbers",
"s": "binary_shift_right( Number1, Number2 )",
"u": "https://docs.cribl.io/search/binary-shift-right"
},
{
"n": "binary_xor",
"k": "function",
"c": "Binary Functions",
"d": "Get the bitwise xor on a pair of numbers",
"s": "binary_xor( Number1, Number2 )",
"u": "https://docs.cribl.io/search/binary-xor"
},
{
"n": "case",
"k": "function",
"c": "Conditional Functions",
"d": "Evaluates a list of predicates and returns the first result expression whose predicate is satisfied",
"s": "case( Predicate_1, Then_1, Predicate_2, Then_2, Predicate_3, Then_3, Else )",
"u": "https://docs.cribl.io/search/case"
},
{
"n": "ceil",
"k": "function",
"c": "Mathematical Functions",
"d": "Rounds up a specified numeric expression's value to its nearest integer",
"s": "ceil(number)",
"u": "https://docs.cribl.io/search/ceil"
},
{
"n": "ceiling",
"k": "function",
"c": "Mathematical Functions",
"d": "Rounds up a specified numeric expression's value to its nearest integer",
"s": "ceiling(number)",
"u": "https://docs.cribl.io/search/ceiling"
},
{
"n": "coalesce",
"k": "function",
"c": "Conditional Functions",
"d": "Evaluates a list of expressions and returns the first non-null (or non-empty for string) expression",
"s": "coalesce( Expression_1, Expression_2, ... )",
"u": "https://docs.cribl.io/search/coalesce"
},
{
"n": "cos",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the cosine function",
"s": "cos( X )",
"u": "https://docs.cribl.io/search/cos"
},
{
"n": "cot",
"k": "function",
"c": "Mathematical Functions",
"d": "Calculates the trigonometric cotangent of the specified angle, in radians",
"s": "cot( X )",
"u": "https://docs.cribl.io/search/cot"
},
{
"n": "count",
"k": "function",
"c": "Statistical Functions",
"d": "Count the occurrences of events",
"s": "count( [Expression] )",
"u": "https://docs.cribl.io/search/count"
},
{
"n": "countif",
"k": "function",
"c": "Statistical Functions",
"d": "Count the occurrences of specific events",
"s": "countif( Predicate )",
"u": "https://docs.cribl.io/search/countif"
},
{
"n": "countof",
"k": "function",
"c": "String Functions",
"d": "Counts occurrences of a substring in a string",
"s": "countof( Source, Search [, Kind] )",
"u": "https://docs.cribl.io/search/countof"
},
{
"n": "createdTime",
"k": "function",
"c": "Context Functions",
"d": "Returns the time when the current search was created",
"s": "createdTime()",
"u": "https://docs.cribl.io/search/createdtime"
},
{
"n": "datetime_add",
"k": "function",
"c": "DateTime Functions",
"d": "Add dates",
"s": "datetime_add( Period, Amount, Datetime )",
"u": "https://docs.cribl.io/search/datetime-add"
},
{
"n": "datetime_diff",
"k": "function",
"c": "DateTime Functions",
"d": "Extract a diff of a date as an integer",
"s": "datetime_diff( Period, Datetime1, Datetime2 )",
"u": "https://docs.cribl.io/search/datetime-diff"
},
{
"n": "datetime_part",
"k": "function",
"c": "DateTime Functions",
"d": "Extract a part of a date as an integer",
"s": "datetime_part( Part, Datetime )",
"u": "https://docs.cribl.io/search/datetime-part"
},
{
"n": "dayofmonth",
"k": "function",
"c": "DateTime Functions",
"d": "Get the day number of the month",
"s": "dayofmonth( Date )",
"u": "https://docs.cribl.io/search/dayofmonth"
},
{
"n": "dayofweek",
"k": "function",
"c": "DateTime Functions",
"d": "The number of days since preceding Sunday",
"s": "dayofweek( Date )",
"u": "https://docs.cribl.io/search/dayofweek"
},
{
"n": "dayofyear",
"k": "function",
"c": "DateTime Functions",
"d": "Get the day number of the year",
"s": "dayofyear( Date )",
"u": "https://docs.cribl.io/search/dayofyear"
},
{
"n": "dcount",
"k": "function",
"c": "Statistical Functions",
"d": "Estimates the number of distinct values",
"s": "dcount( Expression[, Accuracy] )",
"u": "https://docs.cribl.io/search/dcount"
},
{
"n": "dcountif",
"k": "function",
"c": "Statistical Functions",
"d": "Estimates the number of distinct values from specific events",
"s": "dcountif( Expression, Predicate, [, Accuracy] )",
"u": "https://docs.cribl.io/search/dcountif"
},
{
"n": "decrypt",
"k": "function",
"c": "Cryptographic Functions",
"d": "Decrypt data with a key managed by a Cribl Stream Worker Group",
"s": "decrypt(value, workerGroup)",
"u": "https://docs.cribl.io/search/decrypt"
},
{
"n": "degrees",
"k": "function",
"c": "Mathematical Functions",
"d": "Converts angle value in radians into value in degrees",
"s": "degrees( X )",
"u": "https://docs.cribl.io/search/degrees"
},
{
"n": "displayUsername",
"k": "function",
"c": "Context Functions",
"d": "Returns the display name of the user who created the current search",
"s": "displayUsername()",
"u": "https://docs.cribl.io/search/displayusername"
},
{
"n": "earliestTime",
"k": "function",
"c": "Context Functions",
"d": "Returns the start of the current search's time range",
"s": "earliestTime()",
"u": "https://docs.cribl.io/search/earliesttime"
},
{
"n": "encrypt",
"k": "function",
"c": "Cryptographic Functions",
"d": "Encrypt data with a key managed by a Cribl Stream Worker Group",
"s": "encrypt(value, workerGroup, keyId)",
"u": "https://docs.cribl.io/search/encrypt"
},
{
"n": "endofday",
"k": "function",
"c": "DateTime Functions",
"d": "The end of day",
"s": "endofday( Date [, Offset] )",
"u": "https://docs.cribl.io/search/endofday"
},
{
"n": "endofmonth",
"k": "function",
"c": "DateTime Functions",
"d": "The end of month",
"s": "endofmonth( Date [, Offset] )",
"u": "https://docs.cribl.io/search/endofmonth"
},
{
"n": "endofweek",
"k": "function",
"c": "DateTime Functions",
"d": "The end of week",
"s": "endofweek( Date [, Offset] )",
"u": "https://docs.cribl.io/search/endofweek"
},
{
"n": "endofyear",
"k": "function",
"c": "DateTime Functions",
"d": "The end of year",
"s": "endofyear( Date [, Offset] )",
"u": "https://docs.cribl.io/search/endofyear"
},
{
"n": "exp",
"k": "function",
"c": "Mathematical Functions",
"d": "The base-e exponential function of x, which is e raised to the power x",
"s": "exp( X )",
"u": "https://docs.cribl.io/search/exp"
},
{
"n": "exp10",
"k": "function",
"c": "Mathematical Functions",
"d": "Calculates the base-e exponential function of x, which is e raised to the power x",
"s": "exp10( X )",
"u": "https://docs.cribl.io/search/exp10"
},
{
"n": "exp2",
"k": "function",
"c": "Mathematical Functions",
"d": "Calculates the base-2 exponential function of x, which is e raised to the power x",
"s": "exp2( X )",
"u": "https://docs.cribl.io/search/exp2"
},
{
"n": "extract",
"k": "function",
"c": "String Functions",
"d": "Get a match for a regular expression from a source string",
"s": "extract( Regex, CaptureGroup, Source [, TypeLiteral] )",
"u": "https://docs.cribl.io/search/extract"
},
{
"n": "extract_all",
"k": "function",
"c": "String Functions",
"d": "Get a match for a regular expression from a source string",
"s": "extract_all(Regex, [CaptureGroups,] Source)",
"u": "https://docs.cribl.io/search/extract-all"
},
{
"n": "extract_json",
"k": "function",
"c": "String Functions",
"d": "Get a specified element out of a JSON text using a path expression",
"s": "extract_json( JsonPath, DataSource, Type )",
"u": "https://docs.cribl.io/search/extract-json"
},
{
"n": "findearliest",
"k": "function",
"c": "Cribl Functions",
"d": "Get the earliest value",
"s": "findearliest( Expression )",
"u": "https://docs.cribl.io/search/findearliest"
},
{
"n": "findearliestif",
"k": "function",
"c": "Cribl Functions",
"d": "Get the earliest value of specific events",
"s": "findearliestif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/findearliestif"
},
{
"n": "findfirst",
"k": "function",
"c": "Cribl Functions",
"d": "Get the first observed value",
"s": "findfirst( Expression )",
"u": "https://docs.cribl.io/search/findfirst"
},
{
"n": "findfirstif",
"k": "function",
"c": "Cribl Functions",
"d": "Get the first observed value of specific events",
"s": "findfirstif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/findfirstif"
},
{
"n": "findlast",
"k": "function",
"c": "Cribl Functions",
"d": "Get the last observed value",
"s": "findlast( Expression )",
"u": "https://docs.cribl.io/search/findlast"
},
{
"n": "findlastif",
"k": "function",
"c": "Cribl Functions",
"d": "Get the last observed value of specific events",
"s": "findlastif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/findlastif"
},
{
"n": "findlatest",
"k": "function",
"c": "Cribl Functions",
"d": "Get the latest value",
"s": "findlatest( Expression )",
"u": "https://docs.cribl.io/search/findlatest"
},
{
"n": "findlatestif",
"k": "function",
"c": "Cribl Functions",
"d": "Get the latest value of specific events",
"s": "findlatestif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/findlatestif"
},
{
"n": "floor",
"k": "function",
"c": "Conversion Functions",
"d": "Round events into floors",
"s": "floor( Value [, RoundTo ] )",
"u": "https://docs.cribl.io/search/floor"
},
{
"n": "format_bytes",
"k": "function",
"c": "INET Functions",
"d": "Converts a number into a data-size string",
"s": "format_bytes( ByteCount [, Precision [, TargetUnit ] ] )",
"u": "https://docs.cribl.io/search/format-bytes"
},
{
"n": "format_datetime",
"k": "function",
"c": "DateTime Functions",
"d": "Format a datetime",
"s": "format_datetime( Datetime, Format)",
"u": "https://docs.cribl.io/search/format-datetime"
},
{
"n": "format_ipv4",
"k": "function",
"c": "INET Functions",
"d": "Parses input with a netmask and returns string representing IPv4 address",
"s": "format_ipv4( Expression [, PrefixMask ] )",
"u": "https://docs.cribl.io/search/format-ipv4"
},
{
"n": "format_ipv4_mask",
"k": "function",
"c": "INET Functions",
"d": "Parses input with a netmask and returns string representing IPv4 address as CIDR notation",
"s": "format_ipv4_mask( Expression [, PrefixMask ] )",
"u": "https://docs.cribl.io/search/format-ipv4-mask"
},
{
"n": "format_timespan",
"k": "function",
"c": "DateTime Functions",
"d": "Format a timespan",
"s": "format_timespan( Timespan, Format)",
"u": "https://docs.cribl.io/search/format-timespan"
},
{
"n": "from_binary_string",
"k": "function",
"c": "Binary Functions",
"d": "Returns a number from a binary string",
"s": "from_binary_string( String )",
"u": "https://docs.cribl.io/search/from-binary-string"
},
{
"n": "gamma",
"k": "function",
"c": "Mathematical Functions",
"d": "Computes gamma function",
"s": "gamma( X )",
"u": "https://docs.cribl.io/search/gamma"
},
{
"n": "getmonth",
"k": "function",
"c": "DateTime Functions",
"d": "Get the month number from a datetime",
"s": "getmonth( Datetime )",
"u": "https://docs.cribl.io/search/getmonth"
},
{
"n": "gettype",
"k": "function",
"c": "Conversion Functions",
"d": "Returns the type of the input value",
"s": "gettype( Expression )",
"u": "https://docs.cribl.io/search/gettype"
},
{
"n": "getyear",
"k": "function",
"c": "DateTime Functions",
"d": "Get the year from a datetime",
"s": "getyear( Datetime )",
"u": "https://docs.cribl.io/search/getyear"
},
{
"n": "has_any_index",
"k": "function",
"c": "String Functions",
"d": "Get a match for a regular expression from a source string",
"s": "has_any_index( String, LookupArray )",
"u": "https://docs.cribl.io/search/has-any-index"
},
{
"n": "hash",
"k": "function",
"c": "Hash Functions",
"d": "Hash a value",
"s": "hash( Source, Mod )",
"u": "https://docs.cribl.io/search/hash"
},
{
"n": "hash_combine",
"k": "function",
"c": "Hash Functions",
"d": "Combine multiple hash values",
"s": "hash_combine( Hash1 , Hash2 [, Hash3 ...] )",
"u": "https://docs.cribl.io/search/hash-combine"
},
{
"n": "hash_many",
"k": "function",
"c": "Hash Functions",
"d": "Get a combined hash value from multiple values",
"s": "hash_many( Value1 , Value2 [, ValueN ...] )",
"u": "https://docs.cribl.io/search/hash-many"
},
{
"n": "hash_md5",
"k": "function",
"c": "Hash Functions",
"d": "Get an MD5 hash value",
"s": "hash_md5( Source )",
"u": "https://docs.cribl.io/search/hash-md5"
},
{
"n": "hash_sha1",
"k": "function",
"c": "Hash Functions",
"d": "Get a SHA1 hash value",
"s": "hash_sha1( Source )",
"u": "https://docs.cribl.io/search/hash-sha1"
},
{
"n": "hash_sha256",
"k": "function",
"c": "Hash Functions",
"d": "Get a SHA-256 hash value",
"s": "hash_sha256( Source )",
"u": "https://docs.cribl.io/search/hash-sha256"
},
{
"n": "hash_xxhash64",
"k": "function",
"c": "Hash Functions",
"d": "Get a 64-bit hash value",
"s": "hash_xxhash64( Source, Mod )",
"u": "https://docs.cribl.io/search/hash-xxhash64"
},
{
"n": "hourofday",
"k": "function",
"c": "DateTime Functions",
"d": "Get the month number from a datetime",
"s": "hourofday( Datetime )",
"u": "https://docs.cribl.io/search/hourofday"
},
{
"n": "iff",
"k": "function",
"c": "Conditional Functions",
"d": "Evaluates the first argument (the predicate), and returns the value of either the second or third arguments, depending on whether the predicate evaluated to tru",
"s": "iff( Predicate, IfTrue, IfFalse )",
"u": "https://docs.cribl.io/search/iff"
},
{
"n": "iif",
"k": "function",
"c": "Conditional Functions",
"d": "Evaluates the first argument (the predicate), and returns the value of either the second or third arguments, depending on whether the predicate evaluated to tru",
"s": "iif( Predicate, IfTrue, IfFalse )",
"u": "https://docs.cribl.io/search/iif"
},
{
"n": "indexof",
"k": "function",
"c": "String Functions",
"d": "Reports the zero-based index of the first occurrence of a specified string within the input string",
"s": "indexof( Source, Lookup [, StartIndex [, Length [, Occurrence ]]] )",
"u": "https://docs.cribl.io/search/indexof"
},
{
"n": "ipv4_compare",
"k": "function",
"c": "INET Functions",
"d": "Compares two IPv4 strings",
"s": "ipv4_compare( Expr1, Expr2 [, PrefixMask ] )",
"u": "https://docs.cribl.io/search/ipv4-compare"
},
{
"n": "ipv4_is_in_any_range",
"k": "function",
"c": "INET Functions",
"d": "Checks whether IPv4 string address is in any of the specified IPv4 address ranges",
"s": "ipv4_is_in_any_range( Ipv4Address , Ipv4Range [, Ipv4Range ...] )",
"u": "https://docs.cribl.io/search/ipv4-is-in-any-range"
},
{
"n": "ipv4_is_in_range",
"k": "function",
"c": "INET Functions",
"d": "Checks if IPv4 string address is in IPv4-prefix notation range",
"s": "ipv4_is_in_range( Ipv4Address, Ipv4Range )",
"u": "https://docs.cribl.io/search/ipv4-is-in-range"
},
{
"n": "ipv4_is_match",
"k": "function",
"c": "INET Functions",
"d": "Matches two IPv4 strings",
"s": "ipv4_is_match( Expr1, Expr2 [, PrefixMask ] )",
"u": "https://docs.cribl.io/search/ipv4-is-match"
},
{
"n": "ipv4_is_private",
"k": "function",
"c": "INET Functions",
"d": "Checks if IPv4 string address belongs to a set of private network IPs",
"s": "ipv4_is_private( Expression )",
"u": "https://docs.cribl.io/search/ipv4-is-private"
},
{
"n": "ipv4_netmask_suffix",
"k": "function",
"c": "INET Functions",
"d": "Returns the value of the IPv4 netmask suffix from IPv4 string address",
"s": "ipv4_netmask_suffix( Expression )",
"u": "https://docs.cribl.io/search/ipv4-netmask-suffix"
},
{
"n": "ipv6_compare",
"k": "function",
"c": "INET Functions",
"d": "Compares two IPv4 or IPv6 strings",
"s": "ipv6_compare( Expr1, Expr2 [, PrefixMask ] )",
"u": "https://docs.cribl.io/search/ipv6-compare"
},
{
"n": "ipv6_is_match",
"k": "function",
"c": "INET Functions",
"d": "Matches two IPv6 or IPv4 strings",
"s": "ipv6_is_match( Expr1, Expr2 [, PrefixMask ] )",
"u": "https://docs.cribl.io/search/ipv6-is-match"
},
{
"n": "isempty",
"k": "function",
"c": "String Functions",
"d": "Returns true if the argument is an empty string, array, or object, or is null",
"s": "isempty( [ Value ] )",
"u": "https://docs.cribl.io/search/isempty"
},
{
"n": "isfinite",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns whether input is a finite value (is neither infinite nor NaN)",
"s": "isfinite( X )",
"u": "https://docs.cribl.io/search/isfinite"
},
{
"n": "isinf",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns whether input is an infinite (positive or negative) value",
"s": "isinf( X )",
"u": "https://docs.cribl.io/search/isinf"
},
{
"n": "isnan",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns whether input is Not-a-Number (NaN) value",
"s": "isnan( X )",
"u": "https://docs.cribl.io/search/isnan"
},
{
"n": "isnotempty",
"k": "function",
"c": "String Functions",
"d": "Returns true if the argument isn't an empty string, array, or object, and isn't null",
"s": "isnotempty( [ Value ] )",
"u": "https://docs.cribl.io/search/isnotempty"
},
{
"n": "isnotnull",
"k": "function",
"c": "String Functions",
"d": "Returns true if the argument is not null",
"s": "isnotnull( [ Value ] )",
"u": "https://docs.cribl.io/search/isnotnull"
},
{
"n": "isnull",
"k": "function",
"c": "String Functions",
"d": "Evaluates its sole argument and returns a boolean value indicating if the argument evaluates to a null value",
"s": "isnull( [ Expression ] )",
"u": "https://docs.cribl.io/search/isnull"
},
{
"n": "jobID",
"k": "function",
"c": "Context Functions",
"d": "Returns the unique identifier of the current search job",
"s": "jobID()",
"u": "https://docs.cribl.io/search/jobid"
},
{
"n": "latestTime",
"k": "function",
"c": "Context Functions",
"d": "Returns the end of the current search's time range",
"s": "latestTime()",
"u": "https://docs.cribl.io/search/latesttime"
},
{
"n": "list",
"k": "function",
"c": "Cribl Functions",
"d": "Get a list of values",
"s": "list( Expression [, Max ] )",
"u": "https://docs.cribl.io/search/list"
},
{
"n": "log",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the natural logarithm function",
"s": "log( X )",
"u": "https://docs.cribl.io/search/log"
},
{
"n": "log10",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the common (base-10) logarithm function",
"s": "log10( X )",
"u": "https://docs.cribl.io/search/log10"
},
{
"n": "log2",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the (base-2) logarithm function",
"s": "log2( X )",
"u": "https://docs.cribl.io/search/log2"
},
{
"n": "loggamma",
"k": "function",
"c": "Mathematical Functions",
"d": "Computes loggamma function",
"s": "loggamma( X )",
"u": "https://docs.cribl.io/search/loggamma"
},
{
"n": "make_bag",
"k": "function",
"c": "Dynamic Functions",
"d": "Create a property bag from multiple input bags",
"s": "make_bag( Expression, [ MaxOutputSize ] )",
"u": "https://docs.cribl.io/search/make-bag"
},
{
"n": "make_bag_if",
"k": "function",
"c": "Dynamic Functions",
"d": "Create a property bag from those input bags that meet the specified condition",
"s": "make_bag_if( Expression, Predicate, [ MaxOutputSize ] )",
"u": "https://docs.cribl.io/search/make-bag-if"
},
{
"n": "make_datetime",
"k": "function",
"c": "DateTime Functions",
"d": "Create a datetime",
"s": "make_datetime( Year, Month, Day [, Hour] [, Minute] [, Second])",
"u": "https://docs.cribl.io/search/make-datetime"
},
{
"n": "make_timespan",
"k": "function",
"c": "DateTime Functions",
"d": "Create a timespan",
"s": "make_timespan( [ Day ,] Hour, Minute [, Second])",
"u": "https://docs.cribl.io/search/make-timespan"
},
{
"n": "match_regex",
"k": "function",
"c": "String Functions",
"d": "Match with a regex",
"s": "match_regex(Field, Regex)",
"u": "https://docs.cribl.io/search/match_regex"
},
{
"n": "max",
"k": "function",
"c": "Statistical Functions",
"d": "Find the maximum value across a group",
"s": "max( Expression )",
"u": "https://docs.cribl.io/search/max"
},
{
"n": "max_of",
"k": "function",
"c": "Conditional Functions",
"d": "Returns the maximum value of several evaluated numeric expressions",
"s": "max_of( Expression_1, Expression_2, ... )",
"u": "https://docs.cribl.io/search/max-of"
},
{
"n": "maxif",
"k": "function",
"c": "Statistical Functions",
"d": "Find the maximum value across a group of specific events",
"s": "maxif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/maxif"
},
{
"n": "median",
"k": "function",
"c": "Cribl Functions",
"d": "Get the middle value",
"s": "median( Expression )",
"u": "https://docs.cribl.io/search/median"
},
{
"n": "medianif",
"k": "function",
"c": "Cribl Functions",
"d": "Get the middle value of specific events",
"s": "medianif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/medianif"
},
{
"n": "min",
"k": "function",
"c": "Statistical Functions",
"d": "Find the minimum value across a group",
"s": "min( Expression )",
"u": "https://docs.cribl.io/search/min"
},
{
"n": "min_of",
"k": "function",
"c": "Conditional Functions",
"d": "Returns the minimum value of several evaluated numeric expressions",
"s": "min_of( Expression_1, Expression_2, ... )",
"u": "https://docs.cribl.io/search/min-of"
},
{
"n": "minif",
"k": "function",
"c": "Statistical Functions",
"d": "Find the minimum value across a group of specific events",
"s": "minif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/minif"
},
{
"n": "monthofyear",
"k": "function",
"c": "DateTime Functions",
"d": "Get the month number of a year",
"s": "monthofyear( Datetime )",
"u": "https://docs.cribl.io/search/monthofyear"
},
{
"n": "next",
"k": "function",
"c": "Window Functions",
"d": "Returns the next value of a field",
"s": "next(Field [, Offset ] [, DefaultValue ] )",
"u": "https://docs.cribl.io/search/next"
},
{
"n": "not",
"k": "function",
"c": "Mathematical Functions",
"d": "Reverses the value of its boolean argument",
"s": "not( Expression )",
"u": "https://docs.cribl.io/search/not"
},
{
"n": "now",
"k": "function",
"c": "DateTime Functions",
"d": "Get the current UTC time",
"s": "now( [ Offset ] )",
"u": "https://docs.cribl.io/search/now"
},
{
"n": "parse_csv",
"k": "function",
"c": "String Functions",
"d": "Splits a given string representing a single record of comma-separated values and returns a string array with these values",
"s": "parse_csv( Source )",
"u": "https://docs.cribl.io/search/parse-csv"
},
{
"n": "parse_ipv4",
"k": "function",
"c": "String Functions",
"d": "Converts IPv4 string to long (signed 64-bit) number representation in big-endian order",
"s": "parse_ipv4( Expression )",
"u": "https://docs.cribl.io/search/parse-ipv4"
},
{
"n": "parse_ipv4_mask",
"k": "function",
"c": "String Functions",
"d": "Converts the input string of IPv4 and netmask to a signed, 64-bit wide, long number representation in big-endian order",
"s": "parse_ipv4_mask( Expression, PrefixMask )",
"u": "https://docs.cribl.io/search/parse-ipv4-mask"
},
{
"n": "parse_ipv6",
"k": "function",
"c": "String Functions",
"d": "Converts IPv6 or IPv4 string to a canonical IPv6 string representation",
"s": "parse_ipv6( Expression )",
"u": "https://docs.cribl.io/search/parse-ipv6"
},
{
"n": "parse_ipv6_mask",
"k": "function",
"c": "String Functions",
"d": "Converts IPv6/IPv4 string and netmask to a canonical IPv6 string representation",
"s": "parse_ipv6_mask( Expression, PrefixMask )",
"u": "https://docs.cribl.io/search/parse-ipv6-mask"
},
{
"n": "parse_json",
"k": "function",
"c": "String Functions",
"d": "Interprets a string as a JSON value and returns the value as dynamic",
"s": "parse_json( JSON )",
"u": "https://docs.cribl.io/search/parse-json"
},
{
"n": "parse_url",
"k": "function",
"c": "String Functions",
"d": "Parses an absolute URL string and returns a dynamic object contains URL parts",
"s": "parse_url( URL )",
"u": "https://docs.cribl.io/search/parse-url"
},
{
"n": "parse_urlquery",
"k": "function",
"c": "String Functions",
"d": "Returns a dynamic object contains the Query parameters",
"s": "parse_urlquery( Query )",
"u": "https://docs.cribl.io/search/parse-urlquery"
},
{
"n": "parse_version",
"k": "function",
"c": "String Functions",
"d": "Converts the input string representation of a version number to a comparable decimal number",
"s": "parse_version( Expression )",
"u": "https://docs.cribl.io/search/parse-version"
},
{
"n": "percentile",
"k": "function",
"c": "Statistical Functions",
"d": "Calculate the average across a group of specific events",
"s": "percentile( Expression, Percentile )",
"u": "https://docs.cribl.io/search/percentile"
},
{
"n": "persecond",
"k": "function",
"c": "Cribl Functions",
"d": "Get the per second rate",
"s": "persecond( Expression )",
"u": "https://docs.cribl.io/search/persecond"
},
{
"n": "persecondif",
"k": "function",
"c": "Cribl Functions",
"d": "Get the per second rate of specific events",
"s": "persecondif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/persecondif"
},
{
"n": "pi",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the constant value of Pi",
"s": "pi()",
"u": "https://docs.cribl.io/search/pi"
},
{
"n": "pow",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns a result of raising to power",
"s": "pow( Base, Exponent )",
"u": "https://docs.cribl.io/search/pow"
},
{
"n": "prev",
"k": "function",
"c": "Window Functions",
"d": "Returns the previous value of a field",
"s": "prev(Field [, Offset ] [, DefaultValue ] )",
"u": "https://docs.cribl.io/search/prev"
},
{
"n": "query",
"k": "function",
"c": "Context Functions",
"d": "Returns the full query string of the current search",
"s": "query()",
"u": "https://docs.cribl.io/search/query"
},
{
"n": "radians",
"k": "function",
"c": "Mathematical Functions",
"d": "Converts angle value in degrees into value in radians",
"s": "radians( X )",
"u": "https://docs.cribl.io/search/radians"
},
{
"n": "rand",
"k": "function",
"c": "Mathematical Functions",
"d": "Get a random number",
"s": "* rand() - returns a value of type real with a uniform distribution in the range [0.0, 1.0). * rand( N ) - returns a value of type real chosen with a uniform distribution from the set {0.0, 1.0, ..., N - 1}.",
"u": "https://docs.cribl.io/search/rand"
},
{
"n": "range",
"k": "function",
"c": "Mathematical Functions",
"d": "Generates a dynamic array holding a series of equally-spaced values",
"s": "range( Start, Stop[, Step] )",
"u": "https://docs.cribl.io/search/range"
},
{
"n": "rate",
"k": "function",
"c": "Cribl Functions",
"d": "Get the rate observed value",
"s": "rate( Expression, Time )",
"u": "https://docs.cribl.io/search/rate"
},
{
"n": "rateif",
"k": "function",
"c": "Cribl Functions",
"d": "Get the rate observed value of specific events",
"s": "rateif( Expression, Time, Predicate )",
"u": "https://docs.cribl.io/search/rateif"
},
{
"n": "replace_regex",
"k": "function",
"c": "String Functions",
"d": "Replaces all regex matches with another string",
"s": "replace_regex( Text, Regex, Rewrite )",
"u": "https://docs.cribl.io/search/replace-regex"
},
{
"n": "reverse",
"k": "function",
"c": "String Functions",
"d": "Reverses the order of the input string",
"s": "reverse( Source )",
"u": "https://docs.cribl.io/search/reverse"
},
{
"n": "round",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the rounded source to the specified precision",
"s": "round( Source [, Precision] )",
"u": "https://docs.cribl.io/search/round"
},
{
"n": "row_cumsum",
"k": "function",
"c": "Window Functions",
"d": "Calculates the cumulative sum",
"s": "row_cumsum(Term [, Restart ] )",
"u": "https://docs.cribl.io/search/row_cumsum"
},
{
"n": "row_number",
"k": "function",
"c": "Window Functions",
"d": "Returns the current row's index",
"s": "row_number(StartingIndex [, Restart ] )",
"u": "https://docs.cribl.io/search/row_number"
},
{
"n": "row_rank_dense",
"k": "function",
"c": "Window Functions",
"d": "Assigns a dense rank",
"s": "row_rank_dense( Term [, Restart ] )",
"u": "https://docs.cribl.io/search/row_rank_dense"
},
{
"n": "row_rank_min",
"k": "function",
"c": "Window Functions",
"d": "Assigns a minimal rank",
"s": "row_rank_min( Term [, Restart ] )",
"u": "https://docs.cribl.io/search/row_rank_min"
},
{
"n": "row_window_session",
"k": "function",
"c": "Window Functions",
"d": "Identify session starts",
"s": "row_window_session( Expr , MaxDistanceFromFirst , MaxDistanceBetweenNeighbors [, Restart] )",
"u": "https://docs.cribl.io/search/row_window_session"
},
{
"n": "sign",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the sign of a numeric expression",
"s": "sign( X )",
"u": "https://docs.cribl.io/search/sign"
},
{
"n": "sin",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the sine of a numeric expression",
"s": "sin( X )",
"u": "https://docs.cribl.io/search/sin"
},
{
"n": "split",
"k": "function",
"c": "String Functions",
"d": "Replaces all regex matches with another string",
"s": "split( Source, Delimiter [, RequestedIndex] )",
"u": "https://docs.cribl.io/search/split"
},
{
"n": "sqrt",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the square root function",
"s": "sqrt( X )",
"u": "https://docs.cribl.io/search/sqrt"
},
{
"n": "startofday",
"k": "function",
"c": "DateTime Functions",
"d": "Get the start of the day",
"s": "startofday( Date, Offset )",
"u": "https://docs.cribl.io/search/startofday"
},
{
"n": "startofmonth",
"k": "function",
"c": "DateTime Functions",
"d": "Get the start of the month",
"s": "startofmonth( Date, Offset )",
"u": "https://docs.cribl.io/search/startofmonth"
},
{
"n": "startofweek",
"k": "function",
"c": "DateTime Functions",
"d": "Get the start of the week",
"s": "startofweek( Date, Offset )",
"u": "https://docs.cribl.io/search/startofweek"
},
{
"n": "startofyear",
"k": "function",
"c": "DateTime Functions",
"d": "Get the start of the year",
"s": "startofyear( Date, Offset )",
"u": "https://docs.cribl.io/search/startofyear"
},
{
"n": "stdev",
"k": "function",
"c": "Statistical Functions",
"d": "Calculate the standard deviation of events",
"s": "stdev( Expression )",
"u": "https://docs.cribl.io/search/stdev"
},
{
"n": "stdevif",
"k": "function",
"c": "Statistical Functions",
"d": "Find the standard deviation across a group of specific events",
"s": "stdevif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/stdevif"
},
{
"n": "stdevp",
"k": "function",
"c": "Statistical Functions",
"d": "Calculate the standard deviation of population events",
"s": "stdevp( Expression )",
"u": "https://docs.cribl.io/search/stdevp"
},
{
"n": "strcat",
"k": "function",
"c": "String Functions",
"d": "Concatenates between 1 and 64 arguments to a single string",
"s": "strcat( Argument1, Argument2 [, ArgumentN ] )",
"u": "https://docs.cribl.io/search/strcat"
},
{
"n": "strcat_delim",
"k": "function",
"c": "String Functions",
"d": "Concatenates between 2 and 64 arguments, with a delimiter",
"s": "strcat_delim( Delimiter, Argument1, Argument2 [, ArgumentN ] )",
"u": "https://docs.cribl.io/search/strcat-delim"
},
{
"n": "strcmp",
"k": "function",
"c": "String Functions",
"d": "Compares two strings",
"s": "strcmp( String1, String2 )",
"u": "https://docs.cribl.io/search/strcmp"
},
{
"n": "strftime",
"k": "function",
"c": "DateTime Functions",
"d": "Convert a date to a string",
"s": "strftime( TimeSeconds, FormatString )",
"u": "https://docs.cribl.io/search/strftime"
},
{
"n": "strlen",
"k": "function",
"c": "String Functions",
"d": "Returns the length, in characters, of the input string",
"s": "strlen( Source )",
"u": "https://docs.cribl.io/search/strlen"
},
{
"n": "strptime",
"k": "function",
"c": "DateTime Functions",
"d": "Extract time from a string",
"s": "strptime( TimeString, FormatString )",
"u": "https://docs.cribl.io/search/strptime"
},
{
"n": "strrep",
"k": "function",
"c": "String Functions",
"d": "Repeats given string provided amount of times",
"s": "strrep( Value, Multiplier, [ Delimiter ] )",
"u": "https://docs.cribl.io/search/strrep"
},
{
"n": "substring",
"k": "function",
"c": "String Functions",
"d": "Extracts a substring from a source string starting from some index to the end of the string",
"s": "substring( Source, StartingIndex [, Length] )",
"u": "https://docs.cribl.io/search/substring"
},
{
"n": "sum",
"k": "function",
"c": "Statistical Functions",
"d": "Sums the occurrences of events",
"s": "sum( Expression )",
"u": "https://docs.cribl.io/search/sum"
},
{
"n": "sumif",
"k": "function",
"c": "Statistical Functions",
"d": "Sum specific events",
"s": "sumif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/sumif"
},
{
"n": "sumsq",
"k": "function",
"c": "Cribl Functions",
"d": "Get the sum of squares",
"s": "sumsq( Expression )",
"u": "https://docs.cribl.io/search/sumsq"
},
{
"n": "sumsqif",
"k": "function",
"c": "Cribl Functions",
"d": "Get the sum of squares of specific events",
"s": "sumsqif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/sumsqif"
},
{
"n": "take_any",
"k": "function",
"c": "Statistical Functions",
"d": "Get an arbitrary non-null value from a group",
"s": "take_any( Expression )",
"u": "https://docs.cribl.io/search/take_any"
},
{
"n": "take_anyif",
"k": "function",
"c": "Statistical Functions",
"d": "Get an arbitrary non-null value from matching events",
"s": "take_anyif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/take_anyif"
},
{
"n": "tan",
"k": "function",
"c": "Mathematical Functions",
"d": "Returns the tangent function",
"s": "tan( X )",
"u": "https://docs.cribl.io/search/tan"
},
{
"n": "to_binary_string",
"k": "function",
"c": "Binary Functions",
"d": "Returns a binary string from a number",
"s": "to_binary_string( Number )",
"u": "https://docs.cribl.io/search/to-binary-string"
},
{
"n": "tobool",
"k": "function",
"c": "Conversion Functions",
"d": "Converts the input to a value of type bool",
"s": "tobool( Expression )",
"u": "https://docs.cribl.io/search/tobool"
},
{
"n": "todatetime",
"k": "function",
"c": "DateTime Functions",
"d": "Converts the input to a value of type datetime",
"s": "todatetime( Expression )",
"u": "https://docs.cribl.io/search/todatetime"
},
{
"n": "todecimal",
"k": "function",
"c": "Conversion Functions",
"d": "Converts the input to a value of type decimal (double, real)",
"s": "todecimal( Expression )",
"u": "https://docs.cribl.io/search/todecimal"
},
{
"n": "todouble",
"k": "function",
"c": "Conversion Functions",
"d": "Converts the input to a value of type double (real, decimal)",
"s": "todouble( Expression )",
"u": "https://docs.cribl.io/search/todouble"
},
{
"n": "toint",
"k": "function",
"c": "Conversion Functions",
"d": "Converts the input to a value of type int (long)",
"s": "toint( Expression )",
"u": "https://docs.cribl.io/search/toint"
},
{
"n": "tolong",
"k": "function",
"c": "Conversion Functions",
"d": "Converts the input to a value of type long (int)",
"s": "tolong( Expression )",
"u": "https://docs.cribl.io/search/tolong"
},
{
"n": "tolower",
"k": "function",
"c": "String Functions",
"d": "Converts a string to lower case",
"s": "tolower( String )",
"u": "https://docs.cribl.io/search/tolower"
},
{
"n": "toreal",
"k": "function",
"c": "Conversion Functions",
"d": "Converts the input to a value of type real (double, decimal)",
"s": "toreal( Expression )",
"u": "https://docs.cribl.io/search/toreal"
},
{
"n": "tostring",
"k": "function",
"c": "Conversion Functions",
"d": "Converts the input to a value of type string",
"s": "tostring( Expression )",
"u": "https://docs.cribl.io/search/tostring"
},
{
"n": "totimespan",
"k": "function",
"c": "DateTime Functions",
"d": "Converts input into timespan",
"s": "totimespan( Expression )",
"u": "https://docs.cribl.io/search/totimespan"
},
{
"n": "toupper",
"k": "function",
"c": "String Functions",
"d": "Converts a string to upper case",
"s": "toupper( String )",
"u": "https://docs.cribl.io/search/toupper"
},
{
"n": "translate",
"k": "function",
"c": "String Functions",
"d": "Replace a set of characters with another set of characters in a given string",
"s": "translate( SearchList, ReplacementList, Source )",
"u": "https://docs.cribl.io/search/translate"
},
{
"n": "trim",
"k": "function",
"c": "String Functions",
"d": "Removes all leading and trailing matches of the specified regular expression",
"s": "trim( {Regex | String}, Source )",
"u": "https://docs.cribl.io/search/trim"
},
{
"n": "trim_end",
"k": "function",
"c": "String Functions",
"d": "Removes trailing match of the specified regular expression",
"s": "trim_end( Regex, Source )",
"u": "https://docs.cribl.io/search/trim-end"
},
{
"n": "trim_start",
"k": "function",
"c": "String Functions",
"d": "Removes leading match of the specified regular expression",
"s": "trim_start( Regex, Source )",
"u": "https://docs.cribl.io/search/trim-start"
},
{
"n": "unixtime_microseconds_todatetime",
"k": "function",
"c": "DateTime Functions",
"d": "Converts microseconds into datetime",
"s": "unixtime_microseconds_todatetime( Microseconds )",
"u": "https://docs.cribl.io/search/unixtime-microseconds-todatetime"
},
{
"n": "unixtime_milliseconds_todatetime",
"k": "function",
"c": "DateTime Functions",
"d": "Converts milliseconds into datetime",
"s": "unixtime_milliseconds_todatetime( Milliseconds )",
"u": "https://docs.cribl.io/search/unixtime-milliseconds-todatetime"
},
{
"n": "unixtime_nanoseconds_todatetime",
"k": "function",
"c": "DateTime Functions",
"d": "Converts nanoseconds into datetime",
"s": "unixtime_nanoseconds_todatetime( Nanoseconds )",
"u": "https://docs.cribl.io/search/unixtime-nanoseconds-todatetime"
},
{
"n": "unixtime_seconds_todatetime",
"k": "function",
"c": "DateTime Functions",
"d": "Converts seconds into datetime",
"s": "unixtime_seconds_todatetime( Seconds )",
"u": "https://docs.cribl.io/search/unixtime-seconds-todatetime"
},
{
"n": "url_decode",
"k": "function",
"c": "String Functions",
"d": "Converts encoded URL into a to regular URL representation",
"s": "url_decode( EncodedURL )",
"u": "https://docs.cribl.io/search/url-decode"
},
{
"n": "url_encode",
"k": "function",
"c": "String Functions",
"d": "Converts characters of the input URL into a format that can be transmitted over the Internet",
"s": "url_encode( URL )",
"u": "https://docs.cribl.io/search/url-encode"
},
{
"n": "user",
"k": "function",
"c": "Context Functions",
"d": "Returns the username of the user who created the current search",
"s": "user()",
"u": "https://docs.cribl.io/search/user"
},
{
"n": "values",
"k": "function",
"c": "Cribl Functions",
"d": "Get distinct values",
"s": "values( Expression [, Max [, ErrorRate] ] )",
"u": "https://docs.cribl.io/search/values"
},
{
"n": "variance",
"k": "function",
"c": "Statistical Functions",
"d": "Calculate the variance of events",
"s": "variance( Expression )",
"u": "https://docs.cribl.io/search/variance"
},
{
"n": "varianceif",
"k": "function",
"c": "Statistical Functions",
"d": "Calculate the variance of specific events",
"s": "varianceif( Expression, Predicate )",
"u": "https://docs.cribl.io/search/varianceif"
},
{
"n": "variancep",
"k": "function",
"c": "Statistical Functions",
"d": "Calculate the variance of population events",
"s": "variancep( Expression )",
"u": "https://docs.cribl.io/search/variancep"
},
{
"n": "week_of_year",
"k": "function",
"c": "DateTime Functions",
"d": "Get the week number of a year",
"s": "week_of_year( Datetime )",
"u": "https://docs.cribl.io/search/week-of-year"
},
{
"n": "zip",
"k": "function",
"c": "Dynamic Functions",
"d": "Merge multiple dynamic arrays, grouping their elements by index",
"s": "zip( Arrays )",
"u": "https://docs.cribl.io/search/zip"
},
{
"n": "!=",
"k": "operator",
"c": "String Operators",
"d": "Not equal",
"s": "Scope | where Field != (Expression, ... )",
"u": "https://docs.cribl.io/search/not-equals-cs"
},
{
"n": "!contains",
"k": "operator",
"c": "String Operators",
"d": "Right doesn't occur in the left",
"s": "Scope | where Field !contains String",
"u": "https://docs.cribl.io/search/not-contains"
},
{
"n": "!contains_cs",
"k": "operator",
"c": "String Operators",
"d": "Right doesn't occur in the left",
"s": "Scope | where Field !contains_cs String",
"u": "https://docs.cribl.io/search/not-contains-cs"
},
{
"n": "!endswith",
"k": "operator",
"c": "String Operators",
"d": "Right isn't a closing subsequence of the left",
"s": "Scope | where Field !endswith String",
"u": "https://docs.cribl.io/search/not-endswith"
},
{
"n": "!endswith_cs",
"k": "operator",
"c": "String Operators",
"d": "Right isn't a closing subsequence of the left",
"s": "Scope | where Field !endswith_cs String",
"u": "https://docs.cribl.io/search/not-endswith-cs"
},
{
"n": "!has",
"k": "operator",
"c": "String Operators",
"d": "Right doesn't occur in the left",
"s": "Scope | where Field !has String",
"u": "https://docs.cribl.io/search/not-has"
},
{
"n": "!has_all",
"k": "operator",
"c": "String Operators",
"d": "Same as !has but works on all of the elements",
"s": "Scope | where Field !has_all (Expression, ... )",
"u": "https://docs.cribl.io/search/not-has-all"
},
{
"n": "!has_any",
"k": "operator",
"c": "String Operators",
"d": "Same as !has but works on any of the elements",
"s": "Scope | where Field !has_any (Expression, ... )",
"u": "https://docs.cribl.io/search/not-has-any"
},
{
"n": "!has_cs",
"k": "operator",
"c": "String Operators",
"d": "Right doesn't occur in the left",
"s": "Scope | where Field !has_cs String",
"u": "https://docs.cribl.io/search/not-has-cs"
},
{
"n": "!hasprefix",
"k": "operator",
"c": "String Operators",
"d": "Right isn't a term prefix in the left",
"s": "Scope | where Field !hasprefix Expression",
"u": "https://docs.cribl.io/search/not-hasprefix"
},
{
"n": "!hasprefix_cs",
"k": "operator",
"c": "String Operators",
"d": "Right isn't a term prefix in the left",
"s": "Scope | where Field !hasprefix_cs Expression",
"u": "https://docs.cribl.io/search/not-hasprefix-cs"
},
{
"n": "!hassuffix",
"k": "operator",
"c": "String Operators",
"d": "Right isn't a term suffix in the left",
"s": "Scope | where Field !hassuffix Expression",
"u": "https://docs.cribl.io/search/not-hassuffix"
},
{
"n": "!hassuffix_cs",
"k": "operator",
"c": "String Operators",
"d": "Right isn't a term suffix in the left",
"s": "Scope | where Field !hassuffix_cs Expression",
"u": "https://docs.cribl.io/search/not-hassuffix-cs"
},
{
"n": "!in",
"k": "operator",
"c": "String Operators",
"d": "Not equal to any of the events",
"s": "Scope | where Field !in (Expression, ... ) Or: Scope !in ListOfValues",
"u": "https://docs.cribl.io/search/not-in-cs"
},
{
"n": "!in~",
"k": "operator",
"c": "String Operators",
"d": "Not equal to any of the events",
"s": "Scope | where Field !in~ (Expression, ... ) Or: Scope !in~ ListOfValues",
"u": "https://docs.cribl.io/search/not-in"
},
{
"n": "!startswith",
"k": "operator",
"c": "String Operators",
"d": "Right isn't an initial subsequence of the left",
"s": "Scope | where Field !startswith String",
"u": "https://docs.cribl.io/search/not-startswith"
},
{
"n": "!startswith_cs",
"k": "operator",
"c": "String Operators",
"d": "Right isn't an initial subsequence of the left",
"s": "Scope | where Field !startswith_cs String",
"u": "https://docs.cribl.io/search/not-startswith-cs"
},
{
"n": "!~",
"k": "operator",
"c": "String Operators",
"d": "Not equal case-insensitive",
"s": "Scope | where Field !~ (Expression, ... )",
"u": "https://docs.cribl.io/search/not-equals"
},
{
"n": "==",
"k": "operator",
"c": "String Operators",
"d": "Equal",
"s": "Scope | where Field == (Expression, ... )",
"u": "https://docs.cribl.io/search/equals-cs"
},
{
"n": "=~",
"k": "operator",
"c": "String Operators",
"d": "Equal case-insensitive",
"s": "Scope | where Field =~ (Expression, ... )",
"u": "https://docs.cribl.io/search/equals"
},
{
"n": "between",
"k": "operator",
"c": "Filter Operators",
"d": "Filter events that fall within an inclusive range of values",
"s": "betweenExpression: (BANG?) BETWEEN OPEN_PAREN leftRange RANGE rightRange CLOSE_PAREN; leftRange: numericLiteral | stringLiteral | datetimeExpression; rightRange: numericLiteral | stringLiteral | datetimeExpression | time",
"u": "https://docs.cribl.io/search/operators-between"
},
{
"n": "centralize",
"k": "operator",
"c": "Data Operators",
"d": "Force subsequent operators to the coordinator",
"s": "... | centralize",
"u": "https://docs.cribl.io/search/centralize"
},
{
"n": "contains",
"k": "operator",
"c": "String Operators",
"d": "Right occurs as a subsequence of left",
"s": "Scope | where Field contains String",
"u": "https://docs.cribl.io/search/contains"
},
{
"n": "contains_cs",
"k": "operator",
"c": "String Operators",
"d": "Right occurs as a subsequence of left",
"s": "Scope | where Field contains_cs String",
"u": "https://docs.cribl.io/search/contains-cs"
},
{
"n": "count",
"k": "operator",
"c": "Aggregation Operators",
"d": "Count the number of events",
"s": "Scope | count",
"u": "https://docs.cribl.io/search/operators-count"
},
{
"n": "cribl",
"k": "operator",
"c": "Search Operators",
"d": "Find your data",
"s": "[cribl] StringExpression ComparisonExpression [ BooleanOperator ] [ StringExpression | ComparisonExpression ] Either a **StringExpression** or a **ComparisonExpression** is required.",
"u": "https://docs.cribl.io/search/cribl"
},
{
"n": "dedup",
"k": "operator",
"c": "Filter Operators",
"d": "Deduplicate events",
"s": "Scope | dedup [time_window=TimeWindow] [num_duplicates=NumberOfDuplicatesToKeep] by FieldName [, ...]",
"u": "https://docs.cribl.io/search/dedup"
},
{
"n": "distinct",
"k": "operator",
"c": "Filter Operators",
"d": "Find unique field values",
"s": "Scope | distinct [ maxCombinations ] [ maxDepth ] FieldName [= Expression] [, ...]",
"u": "https://docs.cribl.io/search/distinct"
},
{
"n": "endswith",
"k": "operator",
"c": "String Operators",
"d": "Right is a closing subsequence of the left",
"s": "Scope | where Field endswith String",
"u": "https://docs.cribl.io/search/endswith"
},
{
"n": "endswith_cs",
"k": "operator",
"c": "String Operators",
"d": "Right is a closing subsequence of the left",
"s": "Scope | where Field endswith_cs String",
"u": "https://docs.cribl.io/search/endswith-cs"
},
{
"n": "eventstats",
"k": "operator",
"c": "Aggregation Operators",
"d": "Enrich your events with aggregated data",
"s": "Scope | eventstats [max_events=MaxNoOfAggregatedEvents] [[AggregatedField =] AggregationFunction [, ...]] [by [GroupField =] GroupingExpression [ asc | desc ] [ nulls first | nulls last ] [, ...]]",
"u": "https://docs.cribl.io/search/eventstats"
},
{
"n": "export",
"k": "operator",
"c": "Data Operators",
"d": "Send Cribl Search results to a Cribl Lake Dataset, a Search Dataset, a metrics Dataset, or a lookup",
"s": "Scope | export [ suppressPreviews=Previews ] to [ lake ] LakeDatasetName [ tee=Tee ]",
"u": "https://docs.cribl.io/search/export"
},
{
"n": "extend",
"k": "operator",
"c": "Data Operators",
"d": "Append fields created by calculating expressions",
"s": "Scope | extend [FieldName | (FieldName[, ...]) =] Expression [, ...]",
"u": "https://docs.cribl.io/search/extend"
},
{
"n": "externaldata",
"k": "operator",
"c": "Data Operators",
"d": "Fetches external data from HTTP(S) URLs, including public APIs",
"s": "externaldata [ ConnectionURL [, ...] ] [ with ( PropertyName = PropertyValue [, ...]) ]",
"u": "https://docs.cribl.io/search/externaldata"
},
{
"n": "extract",
"k": "operator",
"c": "Data Operators",
"d": "Extracts data",
"s": "... | extract [ SourceOption ] [ type=Type | parser=Parser ] [ type=delimited [ DelimOption ] FieldList ] [ [ type=regex ] [ RegexOption ] RegexLiteral [RegexLiteral[...]] ] [ type=keyvalue [ FieldList ]] [ type=json [ F",
"u": "https://docs.cribl.io/search/extract-operator"
},
{
"n": "find",
"k": "operator",
"c": "Search Operators",
"d": "Find your data",
"s": "* find [withsource=FieldName] [in (Dataset [, Dataset, ...])] where Predicate [project-smart | project FieldName [:FieldType] [, FieldName[:FieldType], ...] * find Predicate [project-smart | project FieldName[:FieldType]",
"u": "https://docs.cribl.io/search/find"
},
{
"n": "foldkeys",
"k": "operator",
"c": "Data Operators",
"d": "Fold hierarchical field names into a nested structure",
"s": "Scope | foldkeys [delete_original=true|false] [separator=\"<Separator>\"] [\"<SelectionRegex>\"]",
"u": "https://docs.cribl.io/search/foldkeys"
},
{
"n": "has",
"k": "operator",
"c": "String Operators",
"d": "Right occurs in the left",
"s": "Scope | where Field has String",
"u": "https://docs.cribl.io/search/has"
},
{
"n": "has_all",
"k": "operator",
"c": "String Operators",
"d": "Same as has but works on all of the elements",
"s": "Scope | where Field has_all (Expression, ... )",
"u": "https://docs.cribl.io/search/has-all"
},
{
"n": "has_any",
"k": "operator",
"c": "String Operators",
"d": "Same as has but works on any of the elements",
"s": "Scope | where Field has_any (Expression, ... )",
"u": "https://docs.cribl.io/search/has-any"
},
{
"n": "has_cs",
"k": "operator",
"c": "String Operators",
"d": "Right occurs in the left",
"s": "Scope | where Field has_cs String",
"u": "https://docs.cribl.io/search/has-cs"
},
{
"n": "hasprefix",
"k": "operator",
"c": "String Operators",
"d": "Right is a term prefix in the left",
"s": "Scope | where Field hasprefix Expression",
"u": "https://docs.cribl.io/search/hasprefix"
},
{
"n": "hasprefix_cs",
"k": "operator",
"c": "String Operators",
"d": "Right isn't a term prefix in the left",
"s": "Scope | where Field hasprefix_cs Expression",
"u": "https://docs.cribl.io/search/hasprefix-cs"
},
{
"n": "hassuffix",
"k": "operator",
"c": "String Operators",
"d": "Right is a term suffix in the left",
"s": "Scope | where Field hassuffix Expression",
"u": "https://docs.cribl.io/search/hassuffix"
},
{
"n": "hassuffix_cs",
"k": "operator",
"c": "String Operators",
"d": "Right is a term suffix in the left",
"s": "Scope | where Field hassuffix_cs Expression",
"u": "https://docs.cribl.io/search/hassuffix-cs"
},
{
"n": "in",
"k": "operator",
"c": "String Operators",
"d": "Equal to any of the events",
"s": "Scope | where Field in (Expression, ... ) Or: Scope in ListOfValues",
"u": "https://docs.cribl.io/search/in-cs"
},
{
"n": "in~",
"k": "operator",
"c": "String Operators",
"d": "Equal to any of the events",
"s": "Scope | where Field in~ (Expression, ... ) Or: Scope in~ ListOfValues",
"u": "https://docs.cribl.io/search/in"
},
{
"n": "ip-lookup",
"k": "operator",
"c": "Data Operators",
"d": "Enrich events with IP address data",
"s": "Scope | ip-lookup [ output=OutputField[, ...] ] [ prefix=Prefix ] [ lang=Lang ] LookupTable [ on IPField ]",
"u": "https://docs.cribl.io/search/ip-lookup"
},
{
"n": "join",
"k": "operator",
"c": "Data Operators",
"d": "Merge events from different Datasets, using the join operator",
"s": "let RightScopeName = RightScope; LeftScope | join [ JoinOptions ] RightScopeName on JoinConditions",
"u": "https://docs.cribl.io/search/join"
},
{
"n": "limit",
"k": "operator",
"c": "Display Operators",
"d": "Limit the number of events",
"s": "Scope | limit Integer",
"u": "https://docs.cribl.io/search/limit"
},
{
"n": "lookup",
"k": "operator",
"c": "Data Operators",
"d": "Enrich events with lookups",
"s": "Scope | lookup [ output=OutputFields[, ...] [ defaultVal=Default ]] [ ignoreCase=Case ] [ matchMode=Mode [ matchType=Type ]] LookupTable on Conditions[, ...]",
"u": "https://docs.cribl.io/search/lookup"
},
{
"n": "matches regex",
"k": "operator",
"c": "String Operators",
"d": "Matches against a field with a regex",
"s": "Scope | where Field matches regex Expression",
"u": "https://docs.cribl.io/search/matches-regex"
},
{
"n": "mv-expand",
"k": "operator",
"c": "Data Operators",
"d": "Expand an object into multiple events",
"s": "* Scope | mv-expand [ bagexpansion=ExpansionMode ] [ with_itemindex=IndexFieldName ] FieldName [, FieldName... ] [ limit Rowlimit ] * Scope | mv-expand [ bagexpansion=ExpansionMode ] [ Name=NewName ] ArrayExpression [, [",
"u": "https://docs.cribl.io/search/mv-expand"
},
{
"n": "mv-pull",
"k": "operator",
"c": "Data Operators",
"d": "Pull key-value pairs into a top-level event, or into a dedicated object or bag",
"s": "<scope> | mv-pull [key=<nameOfKeyFieldInData>] [value=<nameOfValueFieldInData>] [delete_original=<boolean>] <nameOrPathOfFieldToArray> [as <targetFieldName>]",
"u": "https://docs.cribl.io/search/mv-pull"
},
{
"n": "order",
"k": "operator",
"c": "Display Operators",
"d": "Arrange events",
"s": "Scope | order [ topN=MaxNoOfOutputEvents ] [ maxEvents=MaxNoOfInputEvents ] by Field [ asc | desc ] [ nulls first | nulls last ] [, ...]",
"u": "https://docs.cribl.io/search/order"
},
{
"n": "pivot",
"k": "operator",
"c": "Data Operators",
"d": "Turn field values into field names.",
"s": "Scope | pivot DataFields over ColumnFields [by LabelField]",
"u": "https://docs.cribl.io/search/pivot"
},
{
"n": "print",
"k": "operator",
"c": "Display Operators",
"d": "Evaluate one or more scalar expressions",
"s": "print [FieldName =] Expression [, ...]",
"u": "https://docs.cribl.io/search/print"
},
{
"n": "project",
"k": "operator",
"c": "Display Operators",
"d": "Define fields to return",
"s": "* Scope | project FieldName [= Expression] [, ...] * Scope | project [FieldName | (FieldName[,]) =] Expression [, ...]",
"u": "https://docs.cribl.io/search/project"
},
{
"n": "project-away",
"k": "operator",
"c": "Display Operators",
"d": "Exclude fields from the results",
"s": "Scope | project-away ColumnNameOrPattern [, ...]",
"u": "https://docs.cribl.io/search/project-away"
},
{
"n": "project-rename",
"k": "operator",
"c": "Display Operators",
"d": "Rename fields",
"s": "Scope | project-rename NewFieldName = ExistingFieldName [, ...]",
"u": "https://docs.cribl.io/search/project-rename"
},
{
"n": "range",
"k": "operator",
"c": "Display Operators",
"d": "Generate a series of events with a defined range of generated values",
"s": "range <FieldName> from <Start> to <Stop> [step <Step>]",
"u": "https://docs.cribl.io/search/range-operator"
},
{
"n": "render",
"k": "operator",
"c": "Display Operators",
"d": "Choose how to render the results of your search.",
"s": "Scope | render RenderMode",
"u": "https://docs.cribl.io/search/render"
},
{
"n": "search",
"k": "operator",
"c": "Filter Operators",
"d": "Find events with specific text strings",
"s": "[Scope |] search [in (Dataset, ...)] [kind=CaseSensitivity] Predicate",
"u": "https://docs.cribl.io/search/search"
},
{
"n": "send",
"k": "operator",
"c": "Data Operators",
"d": "Send search results to Cribl Stream",
"s": "... | send [ tee=TeeBoolean ] [ group=WorkerGroup | \"URL\" ]",
"u": "https://docs.cribl.io/search/send"
},
{
"n": "sort",
"k": "operator",
"c": "Display Operators",
"d": "Arrange events",
"s": "Scope | sort [ topN=MaxNoOfOutputEvents ] [ maxEvents=MaxNoOfInputEvents ] by Field [ asc | desc ] [ nulls first | nulls last ] [, ...]",
"u": "https://docs.cribl.io/search/sort"
},
{
"n": "startswith",
"k": "operator",
"c": "String Operators",
"d": "Right is an initial subsequence of the left",
"s": "Scope | where Field startswith String",
"u": "https://docs.cribl.io/search/startswith"
},
{
"n": "startswith_cs",
"k": "operator",
"c": "String Operators",
"d": "Right is an initial subsequence of the left",
"s": "Scope | where Field startswith_cs String",
"u": "https://docs.cribl.io/search/startswith-cs"
},
{
"n": "summarize",
"k": "operator",
"c": "Aggregation Operators",
"d": "Aggregate your data",
"s": "Scope | summarize [[AggregatedField =] AggregationFunction [, ...]] [by [GroupField =] GroupingExpression [ asc | desc ] [ nulls first | nulls last ] [, ...]]",
"u": "https://docs.cribl.io/search/summarize"
},
{
"n": "suppress",
"k": "operator",
"c": "Filter Operators",
"d": "Deduplicate events",
"s": "Scope | suppress [time_window=TimeWindow] [num_duplicates=NumberOfDuplicatesToKeep] by FieldName [, ...]",
"u": "https://docs.cribl.io/search/suppress"
},
{
"n": "take",
"k": "operator",
"c": "Display Operators",
"d": "Take a number of events",
"s": "Scope | take Integer",
"u": "https://docs.cribl.io/search/take"
},
{
"n": "timestats",
"k": "operator",
"c": "Aggregation Operators",
"d": "Aggregate by time periods or bins",
"s": "[... |] timestats [ span=Time[ SnapToTime ] | numBins=Bins ] [ timeSource=TimeSource ] [ timeLabel=TimeLabel ] [[ FieldName= ] Aggregation... ] [ by GroupExpression [ asc | desc ] [ nulls first | nulls last ] [, GroupExp",
"u": "https://docs.cribl.io/search/timestats"
},
{
"n": "top",
"k": "operator",
"c": "Display Operators",
"d": "Get the first N events",
"s": "Scope | top NumberOfRows by Expression [ asc | desc ] [ nulls first | nulls last ]",
"u": "https://docs.cribl.io/search/top"
},
{
"n": "top-hitters",
"k": "operator",
"c": "Data Operators",
"d": "Count the most frequent values",
"s": "Scope | top-hitters NumberOfValues of ValueExpression [ by SummingExpression ]",
"u": "https://docs.cribl.io/search/top-hitters"
},
{
"n": "union",
"k": "operator",
"c": "Data Operators",
"d": "Append one set of results to another",
"s": "let SubqueryName = Subquery; MainQuery | union SubqueryName",
"u": "https://docs.cribl.io/search/union"
},
{
"n": "where",
"k": "operator",
"c": "Filter Operators",
"d": "Filter specific events",
"s": "Scope | where Predicate",
"u": "https://docs.cribl.io/search/where"
}
];

export const KQL_OPERATORS = new Set(KQL_CATALOG.filter((e) => e.k === 'operator').map((e) => e.n));
export const KQL_FUNCTIONS = new Set(KQL_CATALOG.filter((e) => e.k === 'function').map((e) => e.n));
