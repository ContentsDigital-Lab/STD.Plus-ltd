const AppError = require('../utils/AppError');

const ID_FIELDS = ['orderNumber', 'requestNumber', 'claimNumber', 'paneNumber'];

const getIdentifiers = async (model, filter) => {
  const docs = await model.find(filter).select([...ID_FIELDS, '_id']).lean();
  return docs.map((doc) => {
    for (const field of ID_FIELDS) {
      if (doc[field]) return doc[field];
    }
    return doc._id.toString();
  });
};

const verifyReferences = async (refs) => {
  for (const { model, id, label } of refs) {
    if (!id) continue;
    const exists = await model.exists({ _id: id });
    if (!exists) {
      throw new AppError(`${label} not found`, 400);
    }
  }
};

const blockDeleteIfReferenced = async (id, dependents) => {
  for (const { model, field, label } of dependents) {
    const count = await model.countDocuments({ [field]: id });
    if (count > 0) {
      const references = await getIdentifiers(model, { [field]: id });
      throw new AppError(`Cannot delete: referenced by ${count} ${label}`, 409, { references, type: label });
    }
  }
};

const blockDeleteManyIfReferenced = async (ids, dependents) => {
  for (const { model, field, label } of dependents) {
    const count = await model.countDocuments({ [field]: { $in: ids } });
    if (count > 0) {
      const references = await getIdentifiers(model, { [field]: { $in: ids } });
      throw new AppError(`Cannot delete: referenced by ${count} ${label}`, 409, { references, type: label });
    }
  }
};

module.exports = { verifyReferences, blockDeleteIfReferenced, blockDeleteManyIfReferenced };
