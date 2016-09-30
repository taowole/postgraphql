import { GraphQLFieldConfig, GraphQLNonNull, GraphQLID, GraphQLArgumentConfig } from 'graphql'
import { Context, Collection, CollectionKey, ObjectType } from '../../../interface'
import { formatName, idSerde, buildObject, scrib } from '../../utils'
import BuildToken from '../BuildToken'
import getType from '../getType'
import transformInputValue from '../transformInputValue'
import createConnectionField from '../connection/createConnectionField'
import getCollectionType from './getCollectionType'

/**
 * Creates any number of query field entries for a collection. These fields
 * will be on the root query type.
 */
export default function createCollectionQueryFieldEntries (
  buildToken: BuildToken,
  collection: Collection,
): Array<[string, GraphQLFieldConfig<mixed, mixed>]> {
  const { options } = buildToken
  const type = collection.type
  const entries: Array<[string, GraphQLFieldConfig<mixed, mixed>]> = []
  const primaryKey = collection.primaryKey
  const paginator = collection.paginator

  // If the collection has a paginator, let’s use it to create a connection
  // field for our collection.
  if (paginator) {
    entries.push([
      formatName.field(`all-${collection.name}`),
      createConnectionField(buildToken, paginator, { withFieldsCondition: true }),
    ])
  }

  // Add a field to select our collection by its primary key, if the
  // collection has a primary key. Note that we abstract away the shape of
  // the primary key in this instance. Instead using a GraphQL native format,
  // the id format.
  if (primaryKey) {
    const field = createCollectionPrimaryKeyField(buildToken, primaryKey)

    // If we got a field back, add it.
    if (field) entries.push([formatName.field(type.name), field])
  }

  // Add a field to select any value in the collection by any key. So all
  // unique keys of an object will be usable to select a single value.
  for (const collectionKey of collection.keys) {
    const field = createCollectionKeyField(buildToken, collectionKey)

    // If we got a field back, add it.
    if (field) entries.push([formatName.field(`${type.name}-by-${collectionKey.name}`), field])
  }

  return entries
}

/**
 * Creates the field used to select an object by its primary key using a
 * GraphQL global id.
 */
function createCollectionPrimaryKeyField <TKey>(
  buildToken: BuildToken,
  collectionKey: CollectionKey<TKey>,
): GraphQLFieldConfig<mixed, mixed> | undefined {
  const { options, inventory } = buildToken
  const { collection } = collectionKey

  // If we can’t read from this collection key, stop.
  if (collectionKey.read == null) return

  const collectionType = getCollectionType(buildToken, collection)

  return {
    description: `Reads a single ${scrib.type(collectionType)} using its globally unique ${scrib.type(GraphQLID)}.`,
    type: collectionType,

    args: {
      [options.nodeIdFieldName]: {
        description: `The globally unique ${scrib.type(GraphQLID)} to be used in selecting a single ${scrib.type(collectionType)}.`,
        type: new GraphQLNonNull(GraphQLID),
      },
    },

    // TODO: Test this resolver
    async resolve (source, args, context): Promise<ObjectType.Value | null> {
      if (!(context instanceof Context))
        throw new Error('GraphQL context must be an instance of `Context`.')

      const { collectionKey, keyValue } = idSerde.deserialize<TKey>(inventory, args[options.nodeIdFieldName] as string)

      if (collectionKey.collection !== collection)
        throw new Error(`The provided id is for collection '${collectionKey.collection.name}', not the expected collection '${collection.name}'.`)

      return await collectionKey.read!(context, keyValue)
    },
  }
}

/**
 * Creates a field using the value from any collection key.
 */
function createCollectionKeyField <TKey>(
  buildToken: BuildToken,
  collectionKey: CollectionKey<TKey>,
): GraphQLFieldConfig<mixed, mixed> | undefined {
  const { collection, keyType } = collectionKey
  const collectionType = getCollectionType(buildToken, collection)

  // If we can’t read from this collection key, stop.
  if (collectionKey.read == null) return

  // If the key type is an object type, we want to flatten the object fields
  // into distinct arguments.
  if (keyType instanceof ObjectType) {
    // Create the definition of our arguments. We will use this definition
    // object in our resolver to turn the `args` object into the correct key
    // value.
    const argsDefinition = buildObject<GraphQLArgumentConfig<mixed> & { internalName: string }>(
      Array.from(keyType.fields).map<[string, GraphQLArgumentConfig<mixed> & { internalName: string }]>(([fieldName, field]) =>
        [formatName.arg(fieldName), {
          description: field.description,
          type: getType(buildToken, field.type, true),
          internalName: fieldName,
        }]
      )
    )
    return {
      type: collectionType,
      args: argsDefinition,
      // TODO: Test this resolver
      async resolve (source, args, context): Promise<ObjectType.Value | null> {
        // Transform our `args` into a proper value for this collection key.
        const key = new Map(Object.keys(argsDefinition).map<[string, mixed]>(key => [
          argsDefinition[key].internalName,
          transformInputValue(argsDefinition[key].type, args[key] as mixed),
        ]))

        if (!(context instanceof Context))
          throw new Error('GraphQL context must be an instance of `Context`.')

        if (!keyType.isTypeOf(key))
          throw new Error('The GraphQL arguments are not of the correct type.')

        return await collectionKey.read!(context, key)
      },
    }
  }
  // Otherwise if this is not an object type, we’ll just expose one argument
  // with the key’s name.
  else {
    const argFieldName = formatName.arg(collectionKey.name)
    const argType = getType(buildToken, keyType, true)
    return {
      description: `Reads a single ${scrib.type(collectionType)} using its unique ${scrib.type(argType)}.`,
      type: collectionType,
      args: {
        [argFieldName]: {
          description: `The unique ${scrib.type(argType)} to be used in selectin a single ${scrib.type(collectionType)}.`,
          type: argType,
        },
      },
      // TODO: Test this resolver
      async resolve (source, args, context): Promise<ObjectType.Value | null> {
        if (!(context instanceof Context))
          throw new Error('GraphQL context must be an instance of `Context`.')

        const key: mixed = transformInputValue(argType, args[argFieldName])

        if (!keyType.isTypeOf(key))
          throw new Error('The GraphQL arguments are not of the correct type.')

        return await collectionKey.read!(context, key)
      },
    }
  }
}