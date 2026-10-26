// Reserve each store's write queue in a fixed order while copying or replacing
// the library. Queued phone uploads and collections resume after maintenance.
function withStoreLocks(stores, task) {
  const reserve = (index) => index === stores.length
    ? task()
    : stores[index].serialize(() => reserve(index + 1));
  return reserve(0);
}

module.exports = { withStoreLocks };
