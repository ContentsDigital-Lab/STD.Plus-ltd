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

const blockDeleteIfReferenced = async (id, dependents) => {
  for (const { model, field, label } of dependents) {
    const count = await model.countDocuments({ [field]: id });
    if (count > 0) {
      throw new AppError(`Cannot delete: referenced by ${count} ${label}`, 409);
    }
  }
};

const blockDeleteManyIfReferenced = async (ids, dependents) => {
  for (const { model, field, label } of dependents) {
    const count = await model.countDocuments({ [field]: { $in: ids } });
    if (count > 0) {
      throw new AppError(`Cannot delete: referenced by ${count} ${label}`, 409);
    }
  }
};

module.exports = { verifyReferences, blockDeleteIfReferenced, blockDeleteManyIfReferenced };
