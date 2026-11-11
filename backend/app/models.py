"""Validated planning inputs. Money is always integer USD cents."""

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Need(Record):
    id: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=40)
    quantity: int = Field(ge=1, le=500)


class Fund(Record):
    id: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=100)
    available_cents: int = Field(ge=0, le=100_000_000)
    categories: list[str] = Field(min_length=1, max_length=10)
    confirmed: bool = True


class Offer(Record):
    id: str = Field(min_length=1, max_length=60)
    supplier: str = Field(min_length=1, max_length=100)
    need_id: str = Field(min_length=1, max_length=60)
    unit_cost_cents: int = Field(ge=1, le=1_000_000)
    stock: int = Field(ge=0, le=500)
    delivery_days: int = Field(ge=0, le=365)
    active: bool = True


class PlanningRequest(Record):
    currency: str = "USD"
    deadline_days: int = Field(ge=0, le=30)
    target_kits: int = Field(ge=1, le=100)
    needs: list[Need] = Field(min_length=1, max_length=6)
    funds: list[Fund] = Field(min_length=1, max_length=6)
    offers: list[Offer] = Field(min_length=1, max_length=24)
    committed: dict[str, int] = Field(default_factory=dict, max_length=6)

    @model_validator(mode="after")
    def check_references(self):
        if self.currency != "USD":
            raise ValueError("This prototype supports USD only.")
        for name in ("needs", "funds", "offers"):
            ids = [row.id for row in getattr(self, name)]
            if len(ids) != len(set(ids)):
                raise ValueError(f"Duplicate {name} identifiers.")
        known = {need.id for need in self.needs}
        if any(key not in known or type(value) is not int or not 0 <= value <= 50000 for key, value in self.committed.items()):
            raise ValueError("Invalid committed quantities.")
        if any(offer.need_id not in known for offer in self.offers):
            raise ValueError("Every offer must reference an existing need.")
        return self


class Allocation(Record):
    fund_id: str
    amount_cents: int = Field(ge=1)


class Purchase(Record):
    offer_id: str
    need_id: str
    supplier: str
    quantity: int = Field(ge=1)
    cost_cents: int = Field(ge=1)
    allocations: list[Allocation]


class Plan(Record):
    id: str
    input_digest: str
    status: str
    complete_kits: int
    target_kits: int
    total_cost_cents: int
    purchases: list[Purchase]
    unmet: dict[str, int]
    notes: list[str]
    elapsed_ms: int
    finance_version: int | None = None

