from datetime import datetime, date
from sqlalchemy.inspection import inspect

class BaseModel:
    """النموذج الأساسي مع وظائف مشتركة لتحويل البيانات إلى قاموس ودعم العلاقات."""

    def to_dict(self, include_relationships: bool = True) -> dict:
        """
        يحول كائن SQLAlchemy إلى قاموس. يدعم تحويل أعمدة الجداول تلقائيًا،
        ويمكن تضمين العلاقات إذا رغب المستخدم.
        """
        result = {}
        mapper = inspect(self.__class__)

        # Columns
        for column in mapper.columns:
            value = getattr(self, column.key)
            if isinstance(value, (datetime, date)):
                result[column.key] = value.isoformat()
            else:
                result[column.key] = value

        # Relationships
        if include_relationships:
            for rel in mapper.relationships:
                try:
                    related = getattr(self, rel.key)
                except Exception:
                    continue
                if related is None:
                    result[rel.key] = None
                elif isinstance(related, list):
                    result[rel.key] = [item.to_dict(include_relationships=False) for item in related]
                else:
                    result[rel.key] = related.to_dict(include_relationships=False)

        return result

    @classmethod
    def from_dict(cls, data: dict):
        """
        ينشئ كائنًا جديدًا من القاموس.
        يتجاهل المفاتيح غير الموجودة في تعريف الجدول.
        العلاقات غير مدعومة في هذه الطريقة.
        """
        mapper = inspect(cls)
        valid_keys = {col.key for col in mapper.columns}
        init_kwargs = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**init_kwargs)

