const AppError = require('../utils/AppError');

const verifyReferences = async (refs) => {
  for (const { model, id, label } of refs) {
    if (!id) continue;
    const exists = await model.exists({ _id: id });
    if (!exists) {
      throw new AppError(`${label} not found`, 400);
    }
  }
};

const cascadeDeleteReferenced = async (id, dependents) => {
  for (const { model, field, cascade, beforeDelete } of dependents) {
    if (cascade || beforeDelete) {
      const docs = await model.find({ [field]: id }).lean();
      if (docs.length > 0) {
        const ids = docs.map(d => d._id);
        if (cascade) await cascadeDeleteManyReferenced(ids, cascade);
        if (beforeDelete) await beforeDelete(docs);
      }
    }
    await model.deleteMany({ [field]: id });
  }
};

const cascadeDeleteManyReferenced = async (ids, dependents) => {
  for (const { model, field, cascade, beforeDelete } of dependents) {
    if (cascade || beforeDelete) {
      const docs = await model.find({ [field]: { $in: ids } }).lean();
      if (docs.length > 0) {
        const childIds = docs.map(d => d._id);
        if (cascade) await cascadeDeleteManyReferenced(childIds, cascade);
        if (beforeDelete) await beforeDelete(docs);
      }
    }
    await model.deleteMany({ [field]: { $in: ids } });
  }
};

module.exports = { verifyReferences, cascadeDeleteReferenced, cascadeDeleteManyReferenced };
