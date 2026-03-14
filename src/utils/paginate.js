const paginate = async (model, { filter = {}, populate = [], sort = '-createdAt', page, limit } = {}) => {
  const p = Math.max(1, parseInt(page) || 1);
  const rawLimit = parseInt(limit);
  const l = Math.min(100, rawLimit > 0 ? rawLimit : 20);
  const skip = (p - 1) * l;

  const [data, total] = await Promise.all([
    model.find(filter).sort(sort).skip(skip).limit(l).populate(populate),
    model.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page: p,
      limit: l,
      total,
      totalPages: Math.ceil(total / l),
    },
  };
};

module.exports = paginate;
