import { types } from 'pg'
import { Type, ObjectType, NullableType, booleanType } from '../../../interface'
import { sql } from '../../utils'
import { PGCatalog, PGCatalogRangeType, PGCatalogNamespace } from '../../introspection'
import transformPGValueIntoValue, { $$transformPGValueIntoValue } from '../transformPGValueIntoValue'
import transformValueIntoPGValue, { $$transformValueIntoPGValue } from '../transformValueIntoPGValue'
import getTypeFromPGType from './getTypeFromPGType'

const typeOidToName = new Map([
  ['3906', 'float_range'],
  ['3908', 'timestamp_range'],
  ['3910', 'timezone_timestamp_range'],
  ['3912', 'date_range'],
])

// TODO: test
class PGRangeObjectType extends ObjectType {
  public readonly pgRangeType: PGCatalogRangeType
  public readonly subType: Type<mixed>

  constructor (
    pgCatalog: PGCatalog,
    pgRangeType: PGCatalogRangeType,
  ) {
    const name = typeOidToName.get(pgRangeType.id) || pgRangeType.name
    const pgSubType = pgCatalog.assertGetType(pgRangeType.rangeSubTypeId)
    const subType = getTypeFromPGType(pgCatalog, pgSubType)

    const boundType = new ObjectType({
      name: `${name}-bound`,
      // TODO: description
      fields: new Map<string, ObjectType.Field<mixed>>([
        ['value', {
          // TODO: description
          type: subType instanceof NullableType ? subType.nonNullType : subType,
        }],
        ['inclusive', {
          // TODO: description
          type: booleanType
        }],
      ]),
    })

    super({
      name,
      description: pgRangeType.description,
      fields: new Map<string, ObjectType.Field<mixed>>([
        ['start', {
          // TODO: description
          type: new NullableType(boundType),
        }],
        ['end', {
          // TODO: description
          type: new NullableType(boundType),
        }],
      ]),
    })

    this.pgRangeType = pgRangeType
    this.subType = subType
  }

  /**
   * Transform a Postgres value into a range value by parsing the range literal
   * and then setting up an object of the correct type.
   */
  public [$$transformPGValueIntoValue] (rangeLiteral: string): ObjectType.Value {
    const range = parseRange(rangeLiteral)
    const rangeValue = new Map<string, mixed>()
    const typeParser = types.getTypeParser(this.pgRangeType.rangeSubTypeId, 'text')

    if (range.start) {
      rangeValue.set('start', new Map<string, mixed>([
        ['value', transformPGValueIntoValue(this.subType, typeParser(range.start.value))],
        ['inclusive', range.start.inclusive],
      ]))
    }

    if (range.end) {
      rangeValue.set('end', new Map<string, mixed>([
        ['value', transformPGValueIntoValue(this.subType, typeParser(range.end.value))],
        ['inclusive', range.end.inclusive],
      ]))
    }

    return rangeValue
  }

  /**
   * Transform this internal value into a Postgres SQL value.
   */
  // TODO: test
  public [$$transformValueIntoPGValue] (rangeValue: ObjectType.Value): sql.SQL {
    const start: Map<string, mixed> | undefined = rangeValue.get('start') as any
    const end: Map<string, mixed> | undefined = rangeValue.get('end') as any
    const lowerInclusive = start != null && start.get('inclusive') ? '[' : '('
    const upperInclusive = end != null && end.get('inclusive') ? ']' : ')'
    const lowerBound = start != null ? transformValueIntoPGValue(this.subType, start.get('value')) : sql.query`null`
    const upperBound = end != null ? transformValueIntoPGValue(this.subType, end.get('value')) : sql.query`null`
    return sql.query`${sql.identifier(this.pgRangeType.namespaceName, this.pgRangeType.name)}(${lowerBound}, ${upperBound}, ${sql.value(lowerInclusive + upperInclusive)})`
  }
}

export default PGRangeObjectType

/**
 * The following range parser was inspired by [`pg-range`][1],
 * [`pg-range-parser`][2], and the [Postgres docs][3] on the range format.
 *
 * [1]: https://github.com/WhoopInc/node-pg-range/blob/65169aa5b920604571ad0bc9d9ec614490241493/lib/parser.js#L22-L48
 * [2]: https://github.com/goodybag/pg-range-parser/blob/3810f0e1cae95f0e49d9ac914bdfcab07d06551a/index.js
 * [3]: https://www.postgresql.org/docs/9.6/static/rangetypes.html
 */

interface PGRange<T> {
  start?: { value: T, inclusive: boolean } | null
  end?: { value: T, inclusive: boolean } | null
}

/**
 * Matches a Postgres range.
 *
 * @private
 */
const rangeMatcherRex = /(\[|\()("((?:\\"|[^"])*)"|[^"]*),("((?:\\"|[^"])*)"|[^"]*)(\]|\))/

/**
 * Parses a range segment into a string or null.
 *
 * @private
 */
function parseRangeSegment (whole: string, quoted: string): string | null {
  if (quoted) return quoted.replace(/\\(.)/g, '$1')
  if (whole === '') return null
  return whole
}

/**
 * Parses a range literal into an object.
 *
 * @private
 */
function parseRange (rangeLiteral: string): PGRange<string> {
  const matches = rangeLiteral.match(rangeMatcherRex)

  // If there were no matches, empty range.
  if (!matches)
    throw new Error('Failed to parse range.')

  // Parse our range segments.
  const lower = parseRangeSegment(matches[2], matches[3])
  const upper = parseRangeSegment(matches[4], matches[5])

  // Construct our range.
  return {
    start: lower == null ? null : {
      value: lower,
      inclusive: matches[1] === '[',
    },
    end: upper == null ? null : {
      value: upper,
      inclusive: matches[6] === ']',
    },
  }
}
