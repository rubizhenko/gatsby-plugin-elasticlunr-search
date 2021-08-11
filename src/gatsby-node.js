const crypto = require(`crypto`)
const { GraphQLScalarType } = require(`gatsby/graphql`)
const elasticlunr = require(`elasticlunr`)

require(`lunr-languages/lunr.stemmer.support`)(elasticlunr)
require(`lunr-languages/lunr.multi`)(elasticlunr)

const lunrLanguages = {
  da: require(`lunr-languages/lunr.da`),
  de: require(`lunr-languages/lunr.de`),
  du: require(`lunr-languages/lunr.du`),
  es: require(`lunr-languages/lunr.es`),
  fi: require(`lunr-languages/lunr.fi`),
  fr: require(`lunr-languages/lunr.fr`),
  hu: require(`lunr-languages/lunr.hu`),
  it: require(`lunr-languages/lunr.it`),
  jp: require(`lunr-languages/lunr.jp`),
  no: require(`lunr-languages/lunr.no`),
  pt: require(`lunr-languages/lunr.pt`),
  ro: require(`lunr-languages/lunr.ro`),
  ru: require(`lunr-languages/lunr.ru`),
  sv: require(`lunr-languages/lunr.sv`),
  tr: require(`lunr-languages/lunr.tr`),
}

const SEARCH_INDEX_ID = `SearchIndex < Site`
const SEARCH_INDEX_TYPE = `SiteSearchIndex`
const parent = `___SOURCE___`

const md5 = src =>
  crypto
    .createHash(`md5`)
    .update(src)
    .digest(`hex`)

const createEmptySearchIndexNode = () => {
  return {
    id: SEARCH_INDEX_ID,
    parent,
    children: [],
    pages: [],
  }
}

const appendPage = ({ pages }, newPage) => {
  const newPages = [...pages, newPage]
  const content = JSON.stringify(newPage)
  return {
    id: SEARCH_INDEX_ID,
    parent,
    children: [],
    pages: newPages,
    internal: {
      type: SEARCH_INDEX_TYPE,
      content: content,
      contentDigest: md5(content),
    },
  }
}

const createOrGetIndex = async (
  node,
  cache,
  getNode,
  getNodesByType,
  getNodes,
  server,
  { fields, resolvers, languages }
) => {
  const cacheKey = `${node.id}:index`
  const cached = await cache.get(cacheKey)
  if (cached) {
    return cached
  }

  const index = elasticlunr(function() {
    if (languages && languages.length) {
      const filteredLanguages = filterLanguagesOption(languages)
      for (let i = 0; i < filteredLanguages.length; i++) {
        const lang = filteredLanguages[i]
        if (lunrLanguages[lang] && lang !== `en`) {
          lunrLanguages[lang](elasticlunr)
        }
      }
      this.use(elasticlunr.multiLanguage.apply(this, filteredLanguages))
    }
  })
  index.setRef(`id`)
  fields.forEach(field => index.addField(field))

  for (const pageId of node.pages) {
    const pageNode = getNode(pageId)

    const fieldResolvers = resolvers[pageNode.internal.type]
    if (fieldResolvers) {
      const doc = {
        id: pageNode.id,
        date: pageNode.date,
        ...Object.keys(fieldResolvers).reduce((prev, key) => {
          return {
            ...prev,
            [key]: fieldResolvers[key](
              pageNode,
              getNode,
              getNodesByType,
              getNodes
            ),
          }
        }, {}),
      }

      index.addDoc(doc)
    }
  }

  const json = index.toJSON()
  await cache.set(cacheKey, json)
  return json
}

const SearchIndex = new GraphQLScalarType({
  name: `${SEARCH_INDEX_TYPE}_Index`,
  description: `Serialized elasticlunr search index`,
  parseValue() {
    throw new Error(`Not supported`)
  },
  serialize(value) {
    return value
  },
  parseLiteral() {
    throw new Error(`Not supported`)
  },
})

const filterLanguagesOption = languages => {
  const filtered = []
  for (let i = 0; i < languages.length; i++) {
    const lang = languages[i]
    const lowercaseLang = lang.toLowerCase()
    const supportedLanguages = Object.keys(lunrLanguages)
    supportedLanguages.push(`en`)
    if (supportedLanguages.indexOf(lowercaseLang) !== -1) {
      filtered.push(lowercaseLang)
    } else {
      console.log(
        `⚠️ @gatsby-contrib/gatsby-plugin-elasticlunr-search - ${lowercaseLang} is not supported`
      )
    }
  }
  return filtered
}

exports.sourceNodes = async ({ getNodes, actions }) => {
  const { touchNode } = actions

  const existingNodes = getNodes().filter(
    n => n.internal.owner === `@gatsby-contrib/gatsby-plugin-elasticlunr-search`
  )
  existingNodes.forEach(node => touchNode(node))
}

exports.onCreateNode = ({ node, actions, getNode }, { resolvers, filter }) => {
  if (Object.keys(resolvers).indexOf(node.internal.type) === -1) {
    return
  }

  if (filter && !filter(node, getNode)) {
    return
  }

  const { createNode } = actions
  const searchIndex = getNode(SEARCH_INDEX_ID) || createEmptySearchIndexNode()
  const newSearchIndex = appendPage(searchIndex, node.id)
  createNode(newSearchIndex)
}

exports.setFieldsOnGraphQLNodeType = (
  { type, getNode, getNodesByType, getNodes, cache },
  pluginOptions
) => {
  if (type.name !== SEARCH_INDEX_TYPE) {
    return null
  }

  return {
    index: {
      type: SearchIndex,
      resolve: (node, _opts, _3, server) =>
        createOrGetIndex(
          node,
          cache,
          getNode,
          getNodesByType,
          getNodes,
          server,
          pluginOptions
        ),
    },
  }
}
